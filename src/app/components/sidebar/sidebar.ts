import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, signal, computed, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UpperCasePipe, DatePipe } from '@angular/common';
import { Subscription, Observable } from 'rxjs';
import { FirebaseService, UserProfile, ChatGroup, Invitation, Status, Message } from '../../services/firebase.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [FormsModule, UpperCasePipe, DatePipe],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class SidebarComponent implements OnInit, OnDestroy {
  @Input() currentUser: UserProfile | null = null;
  @Input() activeChatId = '';
  @Output() chatSelected = new EventEmitter<string>();
  @Output() logoutRequested = new EventEmitter<void>();
  viewMode = signal<'chats' | 'profile' | 'contacts'>('chats');
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
  allStatuses = signal<Status[]>([]);
  allMessages = signal<Message[]>([]);

  unreadCounts = computed(() => {
    const me = this.currentUser?.uid;
    const msgs = this.allMessages();
    const counts = new Map<string, number>();

    if (!me) return counts;

    msgs.forEach(m => {
      if (m.receiverId === me && !m.read) {
        const sender = m.senderId;
        counts.set(sender, (counts.get(sender) || 0) + 1);
      }
    });

    return counts;
  });

  // Status Creator signals
  showStatusCreator = signal(false);
  statusCreatorType = signal<'text' | 'image' | 'video'>('text');
  statusText = signal('');
  statusMediaBase64 = signal<string | null>(null);
  statusMediaCaption = signal('');
  readonly statusBgColors = ['#00a884', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#ef4444', '#14b8a6'];
  statusBgColorIndex = signal(0);
  statusBgColor = computed(() => this.statusBgColors[this.statusBgColorIndex()]);

  // Status Viewer signals
  activeStoryUserUid = signal<string | null>(null);
  activeStoryIndex = signal(0);
  storyReplyText = signal('');
  showStoryViewers = signal(false);
  storyProgress = signal(0);
  private progressInterval: any = null;

  groupedStatuses = computed(() => {
    const statuses = this.allStatuses();
    const map = new Map<string, { user: UserProfile | { uid: string, displayName: string, avatar: string }, items: Status[] }>();
    const all = this.allUsers();
    
    statuses.forEach(s => {
      const user = all.find(u => u.uid === s.uid) || { uid: s.uid, displayName: s.displayName, avatar: s.avatar };
      if (!map.has(s.uid)) {
        map.set(s.uid, { user, items: [] });
      }
      map.get(s.uid)!.items.push(s);
    });
    
    map.forEach(val => {
      val.items.sort((a, b) => a.timestamp - b.timestamp);
    });
    
    return Array.from(map.values()).sort((a, b) => {
      const timeA = a.items[a.items.length - 1].timestamp;
      const timeB = b.items[b.items.length - 1].timestamp;
      return timeB - timeA;
    });
  });

  myStatuses = computed(() => {
    const me = this.currentUser?.uid;
    if (!me) return [];
    return this.allStatuses()
      .filter(s => s.uid === me)
      .sort((a, b) => a.timestamp - b.timestamp);
  });

  friendsStatuses = computed(() => {
    const me = this.currentUser?.uid;
    if (!me) return [];
    return this.groupedStatuses().filter(g => g.user.uid !== me);
  });

  storyViewerOpen = computed(() => this.activeStoryUserUid() !== null);

  activeStoryList = computed(() => {
    const uid = this.activeStoryUserUid();
    if (!uid) return [];
    if (uid === this.currentUser?.uid) {
      return this.myStatuses();
    }
    const group = this.groupedStatuses().find(g => g.user.uid === uid);
    return group ? group.items : [];
  });

  activeStory = computed(() => {
    const list = this.activeStoryList();
    const idx = this.activeStoryIndex();
    return list.length > idx ? list[idx] : null;
  });

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
  this.subs.push(
    this.firebaseService.dataLoaded$.subscribe(loaded => {
      this.loading.set(!loaded);
    })
  );

  this.subs.push(
    this.firebaseService.users$.subscribe(users => {
      this.allUsers.set(users);
    })
  );

  this.subs.push(
    this.firebaseService.groups$.subscribe(groups => {
      this.groups.set(groups);
    })
  );

  this.subs.push(
    this.firebaseService.invitations$.subscribe(invites => {
      this.invitations.set(invites);
    })
  );

  this.subs.push(
    this.firebaseService.statuses$.subscribe(statuses => {
      this.allStatuses.set(statuses);
    })
  );

  this.subs.push(
    this.firebaseService.messages$.subscribe(messages => {
      this.allMessages.set(messages);
    })
  );
}

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.stopStoryTimer();
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

async removeFriend(uid: string) {
  if (confirm('Are you sure you want to remove this friend? You will not be able to chat with them until you connect again.')) {
    this.loading.set(true);
    try {
      await this.firebaseService.deleteFriend(uid);
    } finally {
      this.loading.set(false);
    }
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

  // ================= STATUS STORIES IMPLEMENTATION =================
  openStatusCreator(type: 'text' | 'image' | 'video') {
    this.statusCreatorType.set(type);
    this.showStatusCreator.set(true);
  }

  onStatusFileSelected(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      alert('File size exceeds the 15MB limit.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.statusMediaBase64.set(reader.result as string);
      if (file.type.startsWith('image/')) {
        this.statusCreatorType.set('image');
      } else if (file.type.startsWith('video/')) {
        this.statusCreatorType.set('video');
      } else {
        alert('Unsupported file format. Please upload an image or a video.');
        this.statusMediaBase64.set(null);
      }
    };
    reader.readAsDataURL(file);
  }

  async uploadStatus() {
    const type = this.statusCreatorType();
    let content = '';
    let caption: string | undefined = undefined;
    let bgColor: string | undefined = undefined;

    if (type === 'text') {
      content = this.statusText().trim();
      if (!content) return;
      bgColor = this.statusBgColor();
    } else {
      content = this.statusMediaBase64() || '';
      if (!content) return;
      caption = this.statusMediaCaption().trim();
    }

    this.loading.set(true);
    try {
      await this.firebaseService.uploadStatus(type, content, caption, bgColor);
      this.closeStatusCreator();
    } catch (err) {
      console.error('Failed to upload status:', err);
    } finally {
      this.loading.set(false);
    }
  }

  closeStatusCreator() {
    this.showStatusCreator.set(false);
    this.statusText.set('');
    this.statusMediaBase64.set(null);
    this.statusMediaCaption.set('');
    this.statusBgColorIndex.set(0);
  }

  cycleStatusBgColor() {
    this.statusBgColorIndex.update(idx => (idx + 1) % this.statusBgColors.length);
  }

  openStoryViewer(uid: string) {
    this.activeStoryUserUid.set(uid);
    this.activeStoryIndex.set(0);
    this.startStoryTimer();
  }

  startStoryTimer() {
    this.stopStoryTimer();
    this.storyProgress.set(0);
    this.viewActiveStory();

    this.progressInterval = setInterval(() => {
      this.storyProgress.update(p => {
        if (p >= 100) {
          clearInterval(this.progressInterval);
          this.nextStory();
          return 100;
        }
        return p + 1;
      });
    }, 50);
  }

  stopStoryTimer() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  viewActiveStory() {
    const story = this.activeStory();
    if (story) {
      this.firebaseService.viewStatus(story.id);
    }
  }

  nextStory() {
    this.stopStoryTimer();
    const list = this.activeStoryList();
    const currentIdx = this.activeStoryIndex();
    
    if (currentIdx < list.length - 1) {
      this.activeStoryIndex.set(currentIdx + 1);
      this.startStoryTimer();
    } else {
      const groups = this.friendsStatuses();
      const currentUserUid = this.activeStoryUserUid();
      const currentGroupIdx = groups.findIndex(g => g.user.uid === currentUserUid);
      
      if (currentUserUid !== this.currentUser?.uid && currentGroupIdx >= 0 && currentGroupIdx < groups.length - 1) {
        const nextGroup = groups[currentGroupIdx + 1];
        this.activeStoryUserUid.set(nextGroup.user.uid);
        this.activeStoryIndex.set(0);
        this.startStoryTimer();
      } else {
        this.closeStoryViewer();
      }
    }
  }

  prevStory() {
    this.stopStoryTimer();
    const currentIdx = this.activeStoryIndex();
    
    if (currentIdx > 0) {
      this.activeStoryIndex.set(currentIdx - 1);
      this.startStoryTimer();
    } else {
      const groups = this.friendsStatuses();
      const currentUserUid = this.activeStoryUserUid();
      const currentGroupIdx = groups.findIndex(g => g.user.uid === currentUserUid);
      
      if (currentUserUid !== this.currentUser?.uid && currentGroupIdx > 0) {
        const prevGroup = groups[currentGroupIdx - 1];
        this.activeStoryUserUid.set(prevGroup.user.uid);
        this.activeStoryIndex.set(prevGroup.items.length - 1);
        this.startStoryTimer();
      } else {
        this.startStoryTimer();
      }
    }
  }

  closeStoryViewer() {
    this.stopStoryTimer();
    this.activeStoryUserUid.set(null);
    this.activeStoryIndex.set(0);
    this.storyProgress.set(0);
    this.showStoryViewers.set(false);
  }

  async replyToStory() {
    const story = this.activeStory();
    const reply = this.storyReplyText().trim();
    if (!story || !reply) return;

    try {
      const recipientId = story.uid;
      const messageContent = `💬 Status Reply:\n${reply}`;
      await this.firebaseService.sendMessage(recipientId, messageContent, 'text');
      this.storyReplyText.set('');
      this.closeStoryViewer();
    } catch (err) {
      console.error('Failed to send status reply:', err);
    }
  }

  getViewerNames(uids: string[]): string {
    if (!uids || uids.length === 0) return 'No views yet';
    const all = this.allUsers();
    return uids
      .map(uid => all.find(u => u.uid === uid)?.displayName || 'Unknown Teammate')
      .join(', ');
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
