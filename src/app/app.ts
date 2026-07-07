import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { Subscription } from 'rxjs';
import { FirebaseService, UserProfile, Invitation, ChatGroup, VoiceCall } from './services/firebase.service';
import { AuthComponent } from './components/auth/auth';
import { SidebarComponent } from './components/sidebar/sidebar';
import { ChatComponent } from './components/chat/chat';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AuthComponent, SidebarComponent, ChatComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, OnDestroy {
  loadingAuth = signal(true);
  currentUser = signal<UserProfile | null>(null);
  activeChatId = signal<string>('');
  users = signal<UserProfile[]>([]);
  invitations = signal<Invitation[]>([]);
  groups = signal<ChatGroup[]>([]);
  mobileChatActive = signal(false);

  incomingCall = signal<VoiceCall | null>(null);
  activeCall = signal<VoiceCall | null>(null);
  toasts = signal<{ id: string, title: string, message: string, type: 'success' | 'danger' | 'info' | 'warning' }[]>([]);

  isLoggedIn = computed(() => this.currentUser() !== null);

  activeChatPartner = computed<UserProfile | null>(() => {
    const chatId = this.activeChatId();
    if (!chatId) return null;
    const isGroup = chatId === 'group' || chatId.startsWith('group_') || this.groups().some(g => g.id === chatId);
    if (isGroup) return null;
    return this.users().find(u => u.uid === chatId) || null;
  });

  incomingPendingInvitations = computed(() => {
    const me = this.currentUser()?.uid;
    if (!me) return [];
    return this.invitations().filter(i => i.receiverUid === me && i.status === 'pending');
  });

  private subs: Subscription[] = [];

  constructor(private firebaseService: FirebaseService) {}

  ngOnInit() {
    this.subs.push(
      this.firebaseService.authLoaded$.subscribe(loaded => {
        this.loadingAuth.set(!loaded);
      })
    );

    this.subs.push(
      this.firebaseService.currentUser$.subscribe(user => {
        this.currentUser.set(user);
      })
    );

    this.subs.push(
      this.firebaseService.users$.subscribe(allUsers => {
        this.users.set(allUsers);
      })
    );

    this.subs.push(
      this.firebaseService.invitations$.subscribe(allInvites => {
        this.invitations.set(allInvites);
      })
    );

    this.subs.push(
      this.firebaseService.groups$.subscribe(allGroups => {
        this.groups.set(allGroups);
      })
    );

    this.subs.push(
      this.firebaseService.incomingCall$.subscribe(call => {
        const prev = this.incomingCall();
        this.incomingCall.set(call);
        if (call && !prev) {
          this.showToast(
            `Incoming ${call.isVideo ? 'Video' : 'Voice'} Call`,
            `${call.callerName} is calling...`,
            'info'
          );
        }
      })
    );

    this.subs.push(
      this.firebaseService.activeCall$.subscribe(call => {
        const prev = this.activeCall();
        this.activeCall.set(call);
        if (call && call.status === 'active' && prev?.status === 'calling') {
          const partnerName = this.users().find(u => u.uid === call.receiverId || u.uid === call.callerId)?.displayName || 'Friend';
          this.showToast('Call Connected', `Active call with ${partnerName}.`, 'success');
        } else if (!call && prev) {
          this.showToast('Call Ended', 'The conversation has finished.', 'warning');
        }
      })
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  showToast(title: string, message: string, type: 'success' | 'danger' | 'info' | 'warning' = 'info') {
    const id = 't_' + Date.now() + Math.random();
    this.toasts.update(list => [...list, { id, title, message, type }]);
    setTimeout(() => {
      this.toasts.update(list => list.filter(t => t.id !== id));
    }, 4000);
  }

  getUserInitials(name: string): string {
    if (!name) return '?';
    return name.trim().charAt(0).toUpperCase();
  }

  onLoginSuccess() {
    // currentUser$ subscription will update the signal automatically
  }

  onChatSelected(chatId: string) {
    this.activeChatId.set(chatId);
    this.mobileChatActive.set(true);
  }

  goBackToSidebar() {
    this.mobileChatActive.set(false);
    this.activeChatId.set('');
  }

  async acceptInvite(id: string) {
    try {
      await this.firebaseService.acceptInvitation(id);
    } catch (err) {
      console.error('Failed to accept invitation', err);
    }
  }

  async rejectInvite(id: string) {
    try {
      await this.firebaseService.rejectInvitation(id);
    } catch (err) {
      console.error('Failed to reject invitation', err);
    }
  }

  async acceptCall() {
    const call = this.incomingCall();
    if (!call) return;
    try {
      this.onChatSelected(call.callerId);
      await this.firebaseService.acceptCall(call.id);
    } catch (err: any) {
      this.showToast('Error', err.message || 'Failed to accept call.', 'danger');
    }
  }

  async rejectCall() {
    const call = this.incomingCall();
    if (call) {
      try {
        await this.firebaseService.rejectCall(call.id);
      } catch (err: any) {
        this.showToast('Error', err.message || 'Failed to reject call.', 'danger');
      }
    }
  }

  async onLogoutRequested() {
    await this.firebaseService.logout();
  }
}
