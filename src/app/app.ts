import { Component, OnInit, signal, computed } from '@angular/core';
import { FirebaseService, UserProfile } from './services/firebase.service';
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
export class App implements OnInit {
  loadingAuth = signal(true);
  currentUser = signal<UserProfile | null>(null);
  activeChatId = signal<string>('group');
  users = signal<UserProfile[]>([]);

  isLoggedIn = computed(() => this.currentUser() !== null);

  activeChatPartner = computed<UserProfile | null>(() => {
    const chatId = this.activeChatId();
    if (chatId === 'group' || chatId.startsWith('group_')) return null;
    return this.users().find(u => u.uid === chatId) || null;
  });

  constructor(private firebaseService: FirebaseService) {}

  ngOnInit() {
    this.firebaseService.authLoaded$.subscribe(loaded => {
      this.loadingAuth.set(!loaded);
    });

    this.firebaseService.currentUser$.subscribe(user => {
      this.currentUser.set(user);
    });

    this.firebaseService.users$.subscribe(allUsers => {
      this.users.set(allUsers);
    });
  }

  onLoginSuccess() {
    // currentUser$ subscription will update the signal automatically
  }

  onChatSelected(chatId: string) {
    this.activeChatId.set(chatId);
  }

  async onLogoutRequested() {
    await this.firebaseService.logout();
  }
}
