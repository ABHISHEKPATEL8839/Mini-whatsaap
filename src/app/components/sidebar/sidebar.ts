import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, signal, computed, effect } from '@angular/core';
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
  loading = signal(false);
  inviteLoading = signal(false);
  editingName = signal(false);
  showCreateGroup = signal(false);
  newGroupName = signal('');
  newGroupAvatar = signal('');
  showPendingRequests = signal(false);
  // Group selection state
  selectedGroupMembers = signal<string[]>([]);

  // Invitation and Friend states
  showAddFriend = signal(false);
  inviteEmail = signal('');
  inviteError = signal('');
  inviteSuccess = signal('');

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

  constructor(public firebaseService: FirebaseService) {

    effect(() => {

      console.log(this.currentUser, "chrkckckkk")
    })
  }

ngOnInit() {
  this.loading.set(true);

  let loaded = 0;

  const checkLoaded = () => {
    loaded++;
    if (loaded === 3) {
      this.loading.set(false);
    }
  };

  this.subs.push(
    this.firebaseService.users$.subscribe(users => {
      this.allUsers.set(users);
      checkLoaded();
    })
  );

  this.subs.push(
    this.firebaseService.groups$.subscribe(groups => {
      this.groups.set(groups);
      checkLoaded();
    })
  );

  this.subs.push(
    this.firebaseService.invitations$.subscribe(invites => {
      this.invitations.set(invites);
      checkLoaded();
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
  this.loading.set(true);

  try {
    await this.firebaseService.acceptInvitation(id);
  } finally {
    this.loading.set(false);
  }
}

async rejectInvite(id: string) {
  this.loading.set(true);

  try {
    await this.firebaseService.rejectInvitation(id);
  } finally {
    this.loading.set(false);
  }
}

async deleteInvite(id: string) {
  this.loading.set(true);

  try {
    await this.firebaseService.deleteInvitation(id);
  } finally {
    this.loading.set(false);
  }
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
  this.loading.set(true);

  try {
    const bioText = this.newBio().trim();

    await this.firebaseService.updateProfileData(
      this.currentUser?.displayName || '',
      bioText
    );

    this.editingBio.set(false);
  } finally {
    this.loading.set(false);
  }
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
  if (clean.length < 2) return;

  this.loading.set(true);

  try {
    await this.firebaseService.updateProfileData(
      clean,
      this.currentUser?.bio || ''
    );

    this.editingName.set(false);
  } finally {
    this.loading.set(false);
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
  if (!name) return;

  this.loading.set(true);

  try {
    const members = [
      ...this.selectedGroupMembers(),
      this.currentUser?.uid
    ].filter(Boolean) as string[];

    const avatar = this.newGroupAvatar();

    await this.firebaseService.createGroup(
      name,
      members,
      avatar
    );

    this.newGroupName.set('');
    this.newGroupAvatar.set('');
    this.selectedGroupMembers.set([]);
    this.showCreateGroup.set(false);
  } finally {
    this.loading.set(false);
  }
}

  onProfilePicSelected(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
  reader.onload = async () => {
  const base64 = reader.result as string;

  if (!this.currentUser) return;

  this.loading.set(true);

  try {
    await this.firebaseService.updateProfileData(
      this.currentUser.displayName,
      this.currentUser.bio || '',
      base64
    );
  } finally {
    this.loading.set(false);
  }
};;
    reader.readAsDataURL(file);
  }

  onNewGroupAvatarSelected(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      this.newGroupAvatar.set(reader.result as string);
    };
    reader.readAsDataURL(file);
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
