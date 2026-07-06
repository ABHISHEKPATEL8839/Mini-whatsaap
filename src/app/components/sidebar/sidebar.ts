import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { Subscription, Observable } from 'rxjs';
import { FirebaseService, UserProfile, ChatGroup } from '../../services/firebase.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [FormsModule, AsyncPipe],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class SidebarComponent implements OnInit, OnDestroy {
  @Input() currentUser: UserProfile | null = null;
  @Input() activeChatId = 'group';
  @Output() chatSelected = new EventEmitter<string>();
  @Output() logoutRequested = new EventEmitter<void>();
  viewMode = signal<'chats' | 'profile'>('chats');
  searchQuery = signal('');
  newBio = signal('');
  editingBio = signal(false);
  newName = signal('');
  editingName = signal(false);
  newPassword = signal('');
  editingPassword = signal(false);
  showCreateGroup = signal(false);
  newGroupName = signal('');

  allUsers = signal<UserProfile[]>([]);
  groups = signal<ChatGroup[]>([]);

  filteredUsers = computed(() => {
    const q = this.searchQuery().toLowerCase();
    const uid = this.currentUser?.uid ?? '';
    return this.allUsers().filter((u: UserProfile) =>
      u.uid !== uid && u.displayName.toLowerCase().includes(q)
    );
  });

  filteredGroups = computed(() => {
    const q = this.searchQuery().toLowerCase();
    return this.groups().filter((g: ChatGroup) =>
      g.name.toLowerCase().includes(q)
    );
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
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  selectChat(id: string) {
    this.chatSelected.emit(id);
    this.firebaseService.markAsRead(id);
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

  async savePassword() {
    const pass = this.newPassword().trim();
    if (pass.length >= 6) {
      await this.firebaseService.updateProfileData(
        this.currentUser?.displayName || '',
        this.currentUser?.bio || '',
        pass
      );
      this.newPassword.set('');
    }
    this.editingPassword.set(false);
  }

  async createGroup() {
    const name = this.newGroupName().trim();
    if (name) {
      await this.firebaseService.createGroup(name);
      this.newGroupName.set('');
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
