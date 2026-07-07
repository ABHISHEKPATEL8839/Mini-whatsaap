import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges,
  signal, ViewChild, ElementRef, AfterViewChecked, computed
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { PickerComponent } from '@ctrl/ngx-emoji-mart';
import { FirebaseService, UserProfile, Message, ChatGroup, Invitation, VoiceCall } from '../../services/firebase.service';

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
  
  isChatLoading = signal(false);

  // Voice Recording Signals
  isRecording = signal(false);
  recordingDuration = signal(0);
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recordingTimerInterval: any = null;

  // Voice Call Signals
  activeCall = signal<VoiceCall | null>(null);
  incomingCall = signal<VoiceCall | null>(null);
  callMuted = signal(false);
  speakerEnabled = signal(true);
  callDuration = signal(0);
  private callDurationInterval: any = null;
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private callSignalSub: Subscription | null = null;
  private incomingCallSub: Subscription | null = null;
  private activeCallSub: Subscription | null = null;
  private ringtoneAudioContext: AudioContext | null = null;

  // Audio Playback Signals
  playingAudioId = signal<string | null>(null);
  audioPlaybackStates = signal<{ [msgId: string]: { playing: boolean, progress: number, currentTime: number, duration: number } }>({});
  private activeAudios = new Map<string, HTMLAudioElement>();

  // Visualizer Canvases
  private localAudioContext: AudioContext | null = null;
  private animationFrameId: number | null = null;

  @ViewChild('recordCanvas') private recordCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('callCanvas') private callCanvas!: ElementRef<HTMLCanvasElement>;
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

    this.incomingCallSub = this.firebaseService.incomingCall$.subscribe(call => {
      this.incomingCall.set(call);
      if (call) {
        this.playRingtone();
      } else {
        this.stopRingtone();
      }
    });

    this.activeCallSub = this.firebaseService.activeCall$.subscribe(call => {
      const prevCall = this.activeCall();
      this.activeCall.set(call);
      if (call) {
        if (call.status === 'active') {
          this.stopRingtone();
          this.startCallTimer();
          if (call.type === 'direct' && !this.peerConnection && prevCall?.status === 'calling') {
            this.setupWebRTCPeer(call.id, false);
          }
        }
      } else {
        this.cleanupCall();
      }
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['chatId']) {
      this.subscribeToMessages();
      this.shouldScrollToBottom = true;
      this.clearSelectedFile();
      this.showOptionsMenu.set(false);
      this.isEditingGroup.set(false);
      if (this.isRecording()) {
        this.stopRecording(false);
      }
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

  this.isChatLoading.set(true);

  this.msgSubscription = this.firebaseService
    .getMessagesForChat(this.chatId)
    .subscribe({
      next: (msgs) => {
        this.messages.set(msgs);
        this.shouldScrollToBottom = true;

        // Hide spinner after data arrives
        this.isChatLoading.set(false);
      },
      error: (err) => {
        console.error(err);
        this.isChatLoading.set(false);
      }
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
    if (this.incomingCallSub) {
      this.incomingCallSub.unsubscribe();
    }
    if (this.activeCallSub) {
      this.activeCallSub.unsubscribe();
    }
    if (this.callSignalSub) {
      this.callSignalSub.unsubscribe();
    }
    this.cleanupCall();
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



  openChat(chatId: string) {
  this.isChatLoading.set(true);

  this.chatId = chatId;

  this.firebaseService.getMessagesForChat(chatId).subscribe(messages => {
    this.messages.set(messages);

    this.isChatLoading.set(false);
  });
}

loadChat(chatId: string) {
  this.isChatLoading.set(true);

  this.chatId = chatId;

  this.msgSubscription?.unsubscribe();

  this.msgSubscription = this.firebaseService
    .getMessagesForChat(chatId)
    .subscribe({
      next: (msgs) => {
        this.messages.set(msgs);
        this.isChatLoading.set(false);
        this.shouldScrollToBottom = true;
      },
      error: (err) => {
        console.error(err);
        this.isChatLoading.set(false);
      }
    });
}

  /* ================= AUDIO NOTES RECORDER & PLAYER ================= */

  async startRecording() {
    if (this.isRecording()) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.isRecording.set(true);
      this.recordingDuration.set(0);
      this.audioChunks = [];

      this.mediaRecorder = new MediaRecorder(stream);
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64data = reader.result as string;
          await this.firebaseService.sendMessage(this.chatId, 'Voice Message', 'audio', base64data);
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      this.mediaRecorder.start();

      this.recordingTimerInterval = setInterval(() => {
        this.recordingDuration.update(d => d + 1);
      }, 1000);

      this.setupRecordingVisualizer(stream);

    } catch (err) {
      console.error('Failed to start recording:', err);
      alert('Could not access microphone. Please check permissions.');
    }
  }

  stopRecording(send: boolean) {
    if (!this.isRecording() || !this.mediaRecorder) return;
    
    clearInterval(this.recordingTimerInterval);
    this.stopRecordingVisualizer();

    if (send) {
      this.mediaRecorder.stop();
    } else {
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }

    this.isRecording.set(false);
    this.recordingDuration.set(0);
    this.audioChunks = [];
  }

  formatDuration(sec: number): string {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  setupRecordingVisualizer(stream: MediaStream) {
    setTimeout(() => {
      const canvas = this.recordCanvas?.nativeElement;
      if (!canvas) return;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const draw = () => {
        if (!this.isRecording()) return;
        this.animationFrameId = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#00a884';
        const barWidth = (canvas.width / bufferLength) * 1.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          barHeight = dataArray[i] / 2;
          ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
          x += barWidth;
        }
      };

      draw();
      this.localAudioContext = audioCtx;
    }, 100);
  }

  stopRecordingVisualizer() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.localAudioContext) {
      this.localAudioContext.close();
    }
  }

  toggleAudioPlayback(msgId: string, base64data: string) {
    const state = this.audioPlaybackStates()[msgId] || { playing: false, progress: 0, currentTime: 0, duration: 0 };
    
    let audio = this.activeAudios.get(msgId);
    if (!audio) {
      audio = new Audio(base64data);
      this.activeAudios.set(msgId, audio);
      
      audio.onloadedmetadata = () => {
        this.updateAudioState(msgId, { duration: audio!.duration || 0 });
      };
      audio.ontimeupdate = () => {
        this.updateAudioState(msgId, {
          currentTime: audio!.currentTime,
          progress: (audio!.currentTime / (audio!.duration || 1)) * 100
        });
      };
      audio.onended = () => {
        this.updateAudioState(msgId, { playing: false, progress: 0, currentTime: 0 });
        audio!.currentTime = 0;
      };
    }

    if (state.playing) {
      audio.pause();
      this.updateAudioState(msgId, { playing: false });
    } else {
      const activeId = this.playingAudioId();
      if (activeId && activeId !== msgId) {
        const activeAudio = this.activeAudios.get(activeId);
        if (activeAudio) {
          activeAudio.pause();
          this.updateAudioState(activeId, { playing: false });
        }
      }

      audio.play().catch(e => console.warn('Play block:', e));
      this.playingAudioId.set(msgId);
      this.updateAudioState(msgId, { playing: true });
    }
  }

  private updateAudioState(msgId: string, patch: Partial<{ playing: boolean, progress: number, currentTime: number, duration: number }>) {
    this.audioPlaybackStates.update(states => {
      const current = states[msgId] || { playing: false, progress: 0, currentTime: 0, duration: 0 };
      return {
        ...states,
        [msgId]: { ...current, ...patch }
      };
    });
  }

  /* ================= REAL-TIME ONLINE CALLS ================= */

  async startVoiceCall() {
    try {
      const callId = await this.firebaseService.initiateCall(this.chatId, this.isGroupChat ? 'group' : 'direct');
      if (!this.isGroupChat) {
        this.setupWebRTCPeer(callId, true);
      } else {
        this.joinGroupVoiceCall(callId);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async acceptVoiceCall() {
    const call = this.incomingCall();
    if (!call) return;
    try {
      await this.firebaseService.acceptCall(call.id);
      this.setupWebRTCPeer(call.id, false);
    } catch (err) {
      console.error(err);
    }
  }

  async rejectVoiceCall() {
    const call = this.incomingCall();
    if (call) {
      await this.firebaseService.rejectCall(call.id);
    }
  }

  async endVoiceCall() {
    const call = this.activeCall() || this.incomingCall();
    if (call) {
      await this.firebaseService.endCall(call.id);
    }
  }

  async setupWebRTCPeer(callId: string, isCaller: boolean) {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.setupCallAudioVisualizer(this.localStream);

      const configuration = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      };
      this.peerConnection = new RTCPeerConnection(configuration);

      this.localStream.getTracks().forEach(track => {
        this.peerConnection!.addTrack(track, this.localStream!);
      });

      this.peerConnection.ontrack = (event) => {
        const remoteAudio = new Audio();
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.autoplay = true;
        remoteAudio.play().catch(e => console.warn('Audio play block:', e));
      };

      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.firebaseService.sendCallSignal(callId, {
            candidate: event.candidate.toJSON(),
            isCaller
          });
        }
      };

      if (this.callSignalSub) this.callSignalSub.unsubscribe();
      this.callSignalSub = this.firebaseService.listenCallSignals(callId).subscribe(async (data: any) => {
        if (data.offer && !isCaller) {
          await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await this.peerConnection!.createAnswer();
          await this.peerConnection!.setLocalDescription(answer);
          this.firebaseService.sendCallSignal(callId, { answer: { type: answer.type, sdp: answer.sdp } });
        } else if (data.answer && isCaller) {
          await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(data.answer));
        } else if (data.candidate) {
          await this.peerConnection!.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      });

      if (isCaller) {
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        this.firebaseService.sendCallSignal(callId, { offer: { type: offer.type, sdp: offer.sdp } });
      }

    } catch (err) {
      console.warn('WebRTC peer setup failed (simulated call running):', err);
    }
  }

  async joinGroupVoiceCall(callId: string) {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.setupCallAudioVisualizer(this.localStream);
      await this.firebaseService.acceptCall(callId);
      this.startGroupSpeakingDetector(callId);
    } catch (err) {
      console.error(err);
    }
  }

  private speakingDetectorInterval: any = null;
  startGroupSpeakingDetector(callId: string) {
    if (!this.localStream) return;
    
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(this.localStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let wasSpeaking = false;

    this.speakingDetectorInterval = setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      const isSpeaking = average > 35;

      if (isSpeaking !== wasSpeaking) {
        wasSpeaking = isSpeaking;
        this.firebaseService.updateSpeakerStatus(callId, isSpeaking);
      }
    }, 200);
  }

  setupCallAudioVisualizer(stream: MediaStream) {
    setTimeout(() => {
      const canvas = this.callCanvas?.nativeElement;
      if (!canvas) return;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const draw = () => {
        if (!this.activeCall()) return;
        this.animationFrameId = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
        ctx.lineWidth = 2;

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const baseRadius = 60 + avg * 0.4;

        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius, 0, 2 * Math.PI);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(16, 185, 129, 0.2)';
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius + 15, 0, 2 * Math.PI);
        ctx.stroke();
      };

      draw();
      this.localAudioContext = audioCtx;
    }, 100);
  }

  cleanupCall() {
    this.stopRingtone();
    clearInterval(this.callDurationInterval);
    clearInterval(this.speakingDetectorInterval);
    this.callDuration.set(0);

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.callSignalSub) {
      this.callSignalSub.unsubscribe();
      this.callSignalSub = null;
    }

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.localAudioContext) {
      this.localAudioContext.close();
      this.localAudioContext = null;
    }
  }

  startCallTimer() {
    if (this.callDurationInterval) return;
    this.callDuration.set(0);
    this.callDurationInterval = setInterval(() => {
      this.callDuration.update(d => d + 1);
    }, 1000);
  }

  toggleMute() {
    this.callMuted.update(v => !v);
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !this.callMuted();
      });
    }
  }

  toggleSpeaker() {
    this.speakerEnabled.update(v => !v);
  }

  playRingtone() {
    if (this.ringtoneAudioContext) return;
    try {
      this.ringtoneAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      const playTone = () => {
        if (!this.ringtoneAudioContext) return;
        
        const osc1 = this.ringtoneAudioContext.createOscillator();
        const osc2 = this.ringtoneAudioContext.createOscillator();
        const gain = this.ringtoneAudioContext.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(440, this.ringtoneAudioContext.currentTime);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(480, this.ringtoneAudioContext.currentTime);

        gain.gain.setValueAtTime(0, this.ringtoneAudioContext.currentTime);
        gain.gain.linearRampToValueAtTime(0.2, this.ringtoneAudioContext.currentTime + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ringtoneAudioContext.currentTime + 0.6);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.ringtoneAudioContext.destination);

        osc1.start();
        osc2.start();

        osc1.stop(this.ringtoneAudioContext.currentTime + 0.6);
        osc2.stop(this.ringtoneAudioContext.currentTime + 0.6);
      };

      const interval = setInterval(() => {
        if (!this.ringtoneAudioContext) {
          clearInterval(interval);
          return;
        }
        playTone();
        setTimeout(() => playTone(), 250);
      }, 2500);

      playTone();
      setTimeout(() => playTone(), 250);

    } catch (e) {
      console.warn('Could not play ringtone:', e);
    }
  }
  stopRingtone() {
    if (this.ringtoneAudioContext) {
      this.ringtoneAudioContext.close();
      this.ringtoneAudioContext = null;
    }
  }
}
