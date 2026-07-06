import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges,
  signal, ViewChild, ElementRef, AfterViewChecked, computed
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { PickerComponent } from '@ctrl/ngx-emoji-mart';
import { FirebaseService, UserProfile, Message, ChatGroup, Invitation } from '../../services/firebase.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [FormsModule, PickerComponent],
  templateUrl: './chat.html',
  styleUrl: './chat.css'
})
export class ChatComponent implements OnInit, OnDestroy, OnChanges, AfterViewChecked {
  @Input() chatId = 'group';
  @Input() currentUser: UserProfile | null = null;
  @Input() chatPartner: UserProfile | null = null;
  @Output() backClicked = new EventEmitter<void>();

  @ViewChild('messageContainer') private messageContainer!: ElementRef;
  @ViewChild('fileInput') private fileInput!: ElementRef;

  messages = signal<Message[]>([]);
  invitations = signal<Invitation[]>([]);
  messageText = signal('');
  isSending = signal(false);

  // Emojis list
  showEmojiPicker = signal(false);
  readonly emojis = [
    '😊', '😂', '❤️', '👍', '🔥', '🙌', '😎', '😍',
    '🎉', '💡', '🚀', '✨', '👀', '🤫', '🤔', '😱',
    '👋', '🤝', '☕', '🎂', '🍕', '🎈', '🌈', '💯'
  ];

  // Media Attachment signals
  selectedFileBase64 = signal<string | null>(null);
  selectedFileType = signal<'image' | 'video' | 'document' | null>(null);
  selectedFileName = signal<string | null>(null);

  // Options dropdown and Group edit modal states
  showOptionsMenu = signal(false);
  isEditingGroup = signal(false);
  editingGroupName = signal('');
  editingGroupMembers = signal<string[]>([]);
  editingGroupAvatar = signal('');

  // Users signal to query user information dynamically
  users = signal<UserProfile[]>([]);
  groups = signal<ChatGroup[]>([]);

  get isGroupChat(): boolean {
    const cid = this.chatId;
    return cid === 'group' || cid.startsWith('group_') || this.groups().some(g => g.id === cid);
  }

  friends = computed(() => {
    const me = this.currentUser?.uid;
    if (!me) return [];
    const invites = this.invitations();
    const all = this.users();

    const friendUids = new Set(
      invites
        .filter(i => i.status === 'accepted' && (i.senderUid === me || i.receiverUid === me))
        .map(i => i.senderUid === me ? i.receiverUid : i.senderUid)
    );

    return all.filter(u => friendUids.has(u.uid));
  });

  currentGroup = computed(() => {
    const cid = this.chatId;
    return this.groups().find(g => g.id === cid || g.id === cid.replace('group_', '')) || null;
  });

  isGroupCreator = computed(() => {
    const me = this.currentUser?.uid;
    const g = this.currentGroup();
    if (!me || !g || !g.createdBy) return false;
    return g.createdBy === me;
  });

  friendship = computed(() => {
    const cid = this.chatId;
    const me = this.currentUser?.uid;
    if (this.isGroupChat || !me || !this.chatPartner) {
      return { isGroup: true, status: 'accepted', invite: null };
    }

    const invite = this.invitations().find(i =>
      (i.senderUid === me && i.receiverUid === cid) ||
      (i.senderUid === cid && i.receiverUid === me)
    );

    if (!invite) {
      return { isGroup: false, status: 'none', invite: null };
    }

    return {
      isGroup: false,
      status: invite.status,
      invite
    };
  });

  isGroupMember = computed(() => {
    const cid = this.chatId;
    const me = this.currentUser?.uid;
    if (cid === 'group') return true;
    const g = this.groups().find(x => x.id === cid.replace("group_", ""));
    if (g) {
      return !g.members || (me && g.members.includes(me)) ? true : false;
    }
    if (cid.startsWith('group_')) return false;
    return true;
  });

  private msgSubscription: Subscription | null = null;
  private usersSubscription: Subscription | null = null;
  private groupsSubscription: Subscription | null = null;
  private invitationsSubscription: Subscription | null = null;
  private shouldScrollToBottom = true;

  constructor(public firebaseService: FirebaseService) { }

  toggleOptionsMenu() {
    this.showOptionsMenu.update(v => !v);
  }

  startEditGroup() {
    const g = this.currentGroup();
    if (g) {
      this.editingGroupName.set(g.name);
      this.editingGroupMembers.set(g.members || []);
      this.editingGroupAvatar.set(g.avatar || '');
      this.isEditingGroup.set(true);
    }
    this.showOptionsMenu.set(false);
  }

  cancelEditGroup() {
    this.isEditingGroup.set(false);
  }

  toggleEditingGroupMemberSelection(uid: string) {
    this.editingGroupMembers.update(members =>
      members.includes(uid) ? members.filter(id => id !== uid) : [...members, uid]
    );
  }

  isEditingGroupMemberSelected(uid: string): boolean {
    return this.editingGroupMembers().includes(uid);
  }

  onEditGroupAvatarSelected(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      this.editingGroupAvatar.set(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  async saveGroupEdit() {
    const g = this.currentGroup();
    const name = this.editingGroupName().trim();
    if (g && name) {
      const members = this.editingGroupMembers();
      const avatar = this.editingGroupAvatar();
      await this.firebaseService.updateGroup(g.id, name, members, avatar);
      this.isEditingGroup.set(false);
    }
  }

  async deleteGroup() {
    const g = this.currentGroup();
    if (g && confirm('Are you sure you want to delete this group? All messages in this group will be inaccessible.')) {
      await this.firebaseService.deleteGroup(g.id);
      this.goBack();
    }
    this.showOptionsMenu.set(false);
  }

  async leaveGroup() {
    const g = this.currentGroup();
    if (g && confirm('Are you sure you want to leave this group?')) {
      await this.firebaseService.leaveGroup(g.id);
      this.goBack();
    }
    this.showOptionsMenu.set(false);
  }

  async removeFriend() {
    if (this.chatPartner && confirm('Are you sure you want to remove this friend? You will not be able to chat with them until you connect again.')) {
      await this.firebaseService.deleteFriend(this.chatPartner.uid);
      this.goBack();
    }
    this.showOptionsMenu.set(false);
  }

  goBack() {
    this.backClicked.emit();
  }

  ngOnInit() {
    this.subscribeToMessages();
    this.usersSubscription = this.firebaseService.users$.subscribe(list => {
      this.users.set(list);
    });
    this.groupsSubscription = this.firebaseService.groups$.subscribe(list => {
      this.groups.set(list);
    });
    this.invitationsSubscription = this.firebaseService.invitations$.subscribe(list => {
      this.invitations.set(list);
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['chatId']) {
      this.subscribeToMessages();
      this.shouldScrollToBottom = true;
      this.clearSelectedFile();
      this.showOptionsMenu.set(false);
      this.isEditingGroup.set(false);
    }
  }

  ngAfterViewChecked() {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
    }
  }

  private subscribeToMessages() {
    if (this.msgSubscription) {
      this.msgSubscription.unsubscribe();
    }

    this.msgSubscription = this.firebaseService.getMessagesForChat(this.chatId).subscribe(msgs => {
      this.messages.set(msgs);
      this.shouldScrollToBottom = true;
    });
  }

  ngOnDestroy() {
    if (this.msgSubscription) {
      this.msgSubscription.unsubscribe();
    }
    if (this.usersSubscription) {
      this.usersSubscription.unsubscribe();
    }
    if (this.groupsSubscription) {
      this.groupsSubscription.unsubscribe();
    }
    if (this.invitationsSubscription) {
      this.invitationsSubscription.unsubscribe();
    }
  }

  private scrollToBottom() {
    try {
      if (this.messageContainer) {
        this.messageContainer.nativeElement.scrollTop = this.messageContainer.nativeElement.scrollHeight;
        this.shouldScrollToBottom = false;
      }
    } catch (err) { }
  }

  isSentByMe(message: Message): boolean {
    return message.senderId === this.currentUser?.uid;
  }

  getSenderName(message: Message): string {
    if (this.isSentByMe(message)) return 'You';
    const sender = this.users().find(u => u.uid === message.senderId);
    return sender ? sender.displayName : (message.senderName || 'Friend');
  }

  getSenderAvatar(message: Message): string | null {
    const sender = this.users().find(u => u.uid === message.senderId);
    return sender?.avatar || null;
  }

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  // Emoji Tray
  toggleEmojiPicker() {
    this.showEmojiPicker.update(val => !val);
  }

  addEmoji(emoji: string) {
    this.messageText.update(text => text + emoji);
    this.showEmojiPicker.set(false);
  }

  // File Attachments
  triggerFileSelect() {
    if (this.fileInput) {
      this.fileInput.nativeElement.click();
    }
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const fileType = file.type;
    const isImage = fileType.startsWith('image/');
    const isVideo = fileType.startsWith('video/');

    // Limit base64 to ~8MB to avoid memory leaks
    if (file.size > 8 * 1024 * 1024) {
      alert('File size exceeds the 8MB limit.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.selectedFileBase64.set(reader.result as string);
      if (isImage) {
        this.selectedFileType.set('image');
      } else if (isVideo) {
        this.selectedFileType.set('video');
      } else {
        this.selectedFileType.set('document');
      }
      this.selectedFileName.set(file.name);
    };
    reader.readAsDataURL(file);
  }

  clearSelectedFile() {
    this.selectedFileBase64.set(null);
    this.selectedFileType.set(null);
    this.selectedFileName.set(null);
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  async sendMessage() {
    if (this.friendship().status !== 'accepted' || !this.isGroupMember()) {
      return;
    }

    const text = this.messageText().trim();
    const mediaData = this.selectedFileBase64();
    const mediaType = this.selectedFileType() || 'text';

    if (!text && !mediaData) return;
    if (this.isSending()) return;

    this.isSending.set(true);

    try {
      const sendText = (mediaType === 'document' && !text) ? (this.selectedFileName() || 'Document') : text;
      await this.firebaseService.sendMessage(this.chatId, sendText, mediaType, mediaData || undefined);
      this.messageText.set('');
      this.clearSelectedFile();
    } catch (err) {
      console.error('Failed to send message', err);
    } finally {
      this.isSending.set(false);
    }
    this.shouldScrollToBottom = true;
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  get chatTitle(): string {
    if (this.chatId === 'group') return '🌐 Global Circle';
    if (this.chatId.startsWith('group_')) {
      const g = this.groups().find(x => x.id === this.chatId.replace('group_', ''));
      return g ? ` ${g.name}` : 'Group Chat';
    }
    return this.chatPartner?.displayName || 'Chat';
  }

  get chatSubtitle(): string {
    if (this.chatId === 'group') {
      const activeCount = this.users().filter(u => u.status === 'online').length;
      return `${activeCount} online`;
    }
    if (this.chatId.startsWith('group_')) {
      const g = this.groups().find(x => x.id === this.chatId.replace("group_", ""));
      if (!g) return '0 members';
      const membersCount = g.members ? g.members.length : 1;
      const onlineCount = this.users().filter(u => u.status === 'online' && g.members?.includes(u.uid)).length;
      return `${membersCount} members, ${onlineCount} online`;
    }
    const status = this.chatPartner?.status || 'offline';
    return status === 'online' ? '🟢 Online' : '⚫ Last seen recently';
  }

  // Helper methods for dynamic avatars
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



  async sendInvite() {
    if (this.chatPartner) {
      try {
        await this.firebaseService.sendInvitation(this.chatPartner.email);
      } catch (err) {
        console.error(err);
      }
    }
  }

  async acceptInvite(id: string) {
    await this.firebaseService.acceptInvitation(id);
  }

  async rejectInvite(id: string) {
    await this.firebaseService.rejectInvitation(id);
  }

  async deleteMessage(messageId: string) {
    if (confirm('Are you sure you want to delete this message? This action cannot be undone.')) {
      await this.firebaseService.deleteMessage(messageId);
    }
  }

  addEmojiMart(event: any) {
    const emoji = event.emoji?.native || event.native || event;
    if (emoji) {
      this.messageText.update(text => text + emoji);
    }
    this.showEmojiPicker.set(false);
  }
}