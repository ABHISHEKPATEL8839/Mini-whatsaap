import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AsyncPipe, UpperCasePipe } from '@angular/common';
import { Subscription, Observable } from 'rxjs';
import { FirebaseService, UserProfile, ChatGroup, Invitation } from '../../services/firebase.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [FormsModule, AsyncPipe, UpperCasePipe],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class SidebarComponent implements OnInit, OnDestroy {
  @Input() currentUser: UserProfile | null = null;
  @Input() activeChatId = '';
  @Output() chatSelected = new EventEmitter<string>();
  @Output() logoutRequested = new EventEmitter<void>();
  viewMode = signal<'chats' | 'profile'>('chats');
  searchQuery = signal('');
  newBio = signal('');
  editingBio = signal(false);
  newName = signal('');
  editingName = signal(false);
  showCreateGroup = signal(false);
  newGroupName = signal('');
  showPendingRequests = signal(false);

  // Group editing state
  editingGroupId = signal<string | null>(null);
  editingGroupName = signal<string>('');
  editingGroupMembers = signal<string[]>([]);

  // Group selection state
  selectedGroupMembers = signal<string[]>([]);

  // Invitation and Friend states
  showAddFriend = signal(false);
  inviteEmail = signal('');
  inviteError = signal('');
  inviteSuccess = signal('');
  inviteLoading = signal(false);

  allUsers = signal<UserProfile[]>([]);
  groups = signal<ChatGroup[]>([]);
  invitations = signal<Invitation[]>([]);

  friends = computed(() => {
    const me = this.currentUser?.uid;
    if (!me) return [];
    const invites = this.invitations();
    const all = this.allUsers();

    const friendUids = new Set(
      invites
        .filter(i => i.status === 'accepted' && (i.senderUid === me || i.receiverUid === me))
        .map(i => i.senderUid === me ? i.receiverUid : i.senderUid)
    );

    return all.filter(u => friendUids.has(u.uid));
  });

  filteredUsers = computed(() => {
    const q = this.searchQuery().toLowerCase();
    return this.friends().filter((u: UserProfile) =>
      u.displayName.toLowerCase().includes(q)
    );
  });

  filteredGroups = computed(() => {
    const q = this.searchQuery().toLowerCase();
    const me = this.currentUser?.uid;
    return this.groups().filter((g: ChatGroup) =>
      g.name.toLowerCase().includes(q) &&
      (!g.members || (me && g.members.includes(me)))
    );
  });

  receivedPendingInvitations = computed(() => {
    const me = this.currentUser?.uid;
    if (!me) return [];
    return this.invitations().filter(i => i.receiverUid === me && i.status === 'pending');
  });

  sentInvitations = computed(() => {
    const me = this.currentUser?.uid;
    if (!me) return [];
    return this.invitations().filter(i => i.senderUid === me);
  });

  private subs: Subscription[] = [];

  constructor(public firebaseService: FirebaseService) { }

  ngOnInit() {
    this.subs.push(
      this.firebaseService.users$.subscribe((list: UserProfile[]) => {
        this.allUsers.set(list);
      })
    );

    this.subs.push(
      this.firebaseService.groups$.subscribe((list: ChatGroup[]) => {
        this.groups.set(list);
      })
    );

    this.subs.push(
      this.firebaseService.invitations$.subscribe((list: Invitation[]) => {
        this.invitations.set(list);
      })
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  selectChat(id: string) {
    this.chatSelected.emit(id);
    this.firebaseService.markAsRead(id);
  }

  // Invitation Handlers
  async sendInvite() {
    const email = this.inviteEmail().trim();
    if (!email) return;

    this.inviteLoading.set(true);
    this.inviteError.set('');
    this.inviteSuccess.set('');

    try {
      await this.firebaseService.sendInvitation(email);
      this.inviteSuccess.set('Invitation sent!');
      this.inviteEmail.set('');
      setTimeout(() => this.inviteSuccess.set(''), 3000);
    } catch (err: any) {
      this.inviteError.set(err.message || 'Failed to send invitation.');
      setTimeout(() => this.inviteError.set(''), 5000);
    } finally {
      this.inviteLoading.set(false);
    }
  }

  async acceptInvite(id: string) {
    await this.firebaseService.acceptInvitation(id);
  }

  async rejectInvite(id: string) {
    await this.firebaseService.rejectInvitation(id);
  }

  async deleteInvite(id: string) {
    await this.firebaseService.deleteInvitation(id);
  }

  toggleEditBio() {
    if (this.editingBio()) {
      this.saveBio();
    } else {
      this.newBio.set(this.currentUser?.bio ?? '');
      this.editingBio.set(true);
    }
  }

  async saveBio() {
    const bioText = this.newBio().trim();
    await this.firebaseService.updateProfileData(
      this.currentUser?.displayName || '',
      bioText
    );
    this.editingBio.set(false);
  }

  toggleEditName() {
    if (this.editingName()) {
      this.saveName();
    } else {
      this.newName.set(this.currentUser?.displayName ?? '');
      this.editingName.set(true);
    }
  }

  async saveName() {
    const clean = this.newName().trim();
    if (clean.length >= 2) {
      await this.firebaseService.updateProfileData(
        clean,
        this.currentUser?.bio || ''
      );
    }
    this.editingName.set(false);
  }

  startEditGroup(group: ChatGroup) {
    this.editingGroupId.set(group.id);
    this.editingGroupName.set(group.name);
    this.editingGroupMembers.set(group.members || []);
    this.showCreateGroup.set(false);
    this.showAddFriend.set(false);
    this.showPendingRequests.set(false);
  }

  cancelEditGroup() {
    this.editingGroupId.set(null);
    this.editingGroupName.set('');
    this.editingGroupMembers.set([]);
  }

  isEditingGroupMemberSelected(uid: string): boolean {
    return this.editingGroupMembers().includes(uid);
  }

  toggleEditingGroupMemberSelection(uid: string) {
    this.editingGroupMembers.update(members =>
      members.includes(uid) ? members.filter(id => id !== uid) : [...members, uid]
    );
  }

  async saveGroupEdit() {
    const groupId = this.editingGroupId();
    const name = this.editingGroupName().trim();
    if (groupId && name) {
      const members = this.editingGroupMembers();
      await this.firebaseService.updateGroup(groupId, name, members);
      this.cancelEditGroup();
    }
  }

  async deleteGroup(groupId: string) {
    if (confirm('Are you sure you want to delete this group? All messages in this group will be inaccessible.')) {
      await this.firebaseService.deleteGroup(groupId);
      if (this.activeChatId === groupId) {
        this.chatSelected.emit('');
      }
    }
  }

  async removeFriend(friendUid: string) {
    if (confirm('Are you sure you want to remove this friend? You will not be able to chat with them until you connect again.')) {
      await this.firebaseService.deleteFriend(friendUid);
      if (this.activeChatId === friendUid) {
        this.chatSelected.emit('');
      }
    }
  }

  isMemberSelected(uid: string): boolean {
    return this.selectedGroupMembers().includes(uid);
  }

  toggleMemberSelection(uid: string) {
    this.selectedGroupMembers.update(members =>
      members.includes(uid) ? members.filter(id => id !== uid) : [...members, uid]
    );
  }

  async createGroup() {
    const name = this.newGroupName().trim();
    if (name) {
      const members = [...this.selectedGroupMembers(), this.currentUser?.uid].filter(Boolean) as string[];
      await this.firebaseService.createGroup(name, members);
      this.newGroupName.set('');
      this.selectedGroupMembers.set([]);
      this.showCreateGroup.set(false);
    }
  }

  getUnreadCount(uid: string): Observable<number> {
    return this.firebaseService.getUnreadCount(uid);
  }

  logout() {
    this.logoutRequested.emit();
  }

  getUserInitials(name: string): string {
    if (!name) return '?';
    return name.trim().charAt(0).toUpperCase();
  }

  getUserColor(uid: string): string {
    if (!uid) return '#00a884';
    const colors = [
      '#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb', '#64b5f6',
      '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784', '#aed581', '#d4e157',
      '#ffd54f', '#ffb74d', '#ff8a65', '#a1887f'
    ];
    let hash = 0;
    for (let i = 0; i < uid.length; i++) {
      hash = uid.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  }
}
