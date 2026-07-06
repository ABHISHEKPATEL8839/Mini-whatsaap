import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, map, of } from 'rxjs';
import { environment } from '../../environments/environment';

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  updatePassword,
  onAuthStateChanged,
  signOut,
  Auth
} from 'firebase/auth';

import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  getDocs,
  where,
  writeBatch,
  Firestore,
  serverTimestamp,
  deleteDoc,
  arrayRemove
} from 'firebase/firestore';

/* ================= MODELS ================= */

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  avatar: string;
  photoURL?: string | null;
  status: 'online' | 'offline';
  bio: string;
  lastSeen: number;
  password?: string; // used for local mock checks
}

export interface ChatGroup {
  id: string;
  name: string;
  createdAt: number;
  createdBy: string;
  members?: string[];
  avatar?: string;
}

export interface Invitation {
  id: string;
  senderUid: string;
  senderEmail: string;
  senderName: string;
  receiverUid: string;
  receiverEmail: string;
  status: 'pending' | 'accepted' | 'rejected';
  timestamp: number;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  receiverId: string;
  content: string;
  timestamp: any;
  mediaType?: 'image' | 'video' | 'text' | 'document';
  mediaData?: string; // base64 payload
  read?: boolean; // unread count tracking for DMs
}

const MOCK_FRIENDS: UserProfile[] = [
  {
    uid: 'rahul_01',
    email: 'rahul@gmail.com',
    displayName: 'Rahul Sharma',
    avatar: '👤',
    status: 'online',
    bio: 'Building things 🚀',
    lastSeen: Date.now()
  },
  {
    uid: 'priya_02',
    email: 'priya@gmail.com',
    displayName: 'Priya Patel',
    avatar: '👤',
    status: 'online',
    bio: 'Coffee & code ☕',
    lastSeen: Date.now()
  }
];

const MOCK_REPLIES = [
  'Hey 👋',
  'Nice 😄',
  'Cool 🔥',
  'Let’s go!',
  'Haha 😂',
  'Absolutely!',
  'How are you?'
];

@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private db: Firestore | null = null;

  isMockMode = true;

  private mockUsers: UserProfile[] = [];
  private mockMessages: Message[] = [];
  private mockGroups: ChatGroup[] = [];
  private mockInvitations: Invitation[] = [];

  private readonly KEY_USERS = 'users';
  private readonly KEY_MESSAGES = 'messages';
  private readonly KEY_SESSION = 'session';
  private readonly KEY_GROUPS = 'groups';
  private readonly KEY_INVITATIONS = 'invitations';

  private _currentUser$ = new BehaviorSubject<UserProfile | null>(null);
  private _users$ = new BehaviorSubject<UserProfile[]>([]);
  private _messages$ = new BehaviorSubject<Message[]>([]);
  private _groups$ = new BehaviorSubject<ChatGroup[]>([]);
  private _invitations$ = new BehaviorSubject<Invitation[]>([]);
  private _authLoaded$ = new BehaviorSubject<boolean>(false);

  readonly currentUser$ = this._currentUser$.asObservable();
  readonly users$ = this._users$.asObservable();
  readonly messages$ = this._messages$.asObservable();
  readonly groups$ = this._groups$.asObservable();
  readonly invitations$ = this._invitations$.asObservable();
  readonly authLoaded$ = this._authLoaded$.asObservable();

  constructor() {
    this.boot();
  }

  /* ================= BOOT ================= */

  private boot() {
    const forcedMock = localStorage.getItem('abhi_forced_mock') === 'true';
    const cfg = environment.firebase;
    const isMock =
      forcedMock ||
      !cfg ||
      cfg.apiKey === 'YOUR_API_KEY' ||
      cfg.projectId === 'YOUR_PROJECT_ID';

    if (isMock) {
      this.isMockMode = true;
      this.bootMock();
      return;
    }

    try {
      this.app = getApps().length ? getApps()[0] : initializeApp(cfg);
      this.auth = getAuth(this.app);
      this.db = getFirestore(this.app);
      this.isMockMode = false;
      this.bootFirebase();
    } catch (e) {
      console.error('Firebase failed → mock mode', e);
      this.isMockMode = true;
      this.bootMock();
    }
  }

  /* ================= FIREBASE ================= */

  private bootFirebase() {
    if (!this.auth || !this.db) return;

    let firstAuthCheck = true;

    onAuthStateChanged(this.auth, async (user) => {
      try {
        if (!user) {
          // Change status to offline in database before logging out
          const current = this._currentUser$.value;
          if (current) {
            try {
              await this.setUserStatus(current.uid, 'offline');
            } catch (statusErr) { }
          }
          this._currentUser$.next(null);
          if (firstAuthCheck) {
            firstAuthCheck = false;
            this._authLoaded$.next(true);
          }
          return;
        }

        // Query firestore for existing user profile
        const userRef = doc(this.db!, 'users', user.uid);
        let bio = 'Hey there! I am using Abhi WhatsApp.';
        let avatar = '👤';
        let photoURL = '👤';
        try {
          const userSnap = await getDocs(query(collection(this.db!, 'users'), where('uid', '==', user.uid)));
          if (!userSnap.empty) {
            const data = userSnap.docs[0].data() as UserProfile;
            bio = data.bio || bio;
            avatar = data.avatar || avatar;
            photoURL = data.photoURL || data.avatar || photoURL;
          }
        } catch (snapErr) {
          console.warn('Firestore read blocked by rules, using default bio');
        }

        const profile: UserProfile = {
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || 'User',
          avatar: avatar,
          status: 'online',
          bio: bio,
          lastSeen: Date.now(),
          photoURL: photoURL
        };

        this._currentUser$.next(profile);
        await setDoc(userRef, profile, { merge: true });

        // Add window event listener for tab closes
        window.addEventListener('beforeunload', () => {
          this.setUserStatus(user.uid, 'offline');
        });

        if (firstAuthCheck) {
          firstAuthCheck = false;
          this._authLoaded$.next(true);
        }

        this.listenUsersFirebase();
        this.listenMessagesFirebase();
        this.listenGroupsFirebase();
        this.listenInvitationsFirebase();
      } catch (err) {
        console.warn('Firebase initialization failed on boot, falling back to mock mode:', err);
        localStorage.setItem('abhi_forced_mock', 'true');
        this.isMockMode = true;
        this.bootMock();
      }
    });
  }

  private async setUserStatus(uid: string, status: 'online' | 'offline') {
    if (this.isMockMode || !this.db) return;
    try {
      await updateDoc(doc(this.db, 'users', uid), {
        status,
        lastSeen: Date.now()
      });
    } catch (err) {
      console.error('Failed to update status', err);
    }
  }

  private listenUsersFirebase() {
    if (!this.db) return;

    onSnapshot(collection(this.db, 'users'), (snap) => {
      const users = snap.docs.map(d => d.data() as UserProfile);
      this._users$.next(users);
    });
  }

  private listenMessagesFirebase() {
    if (!this.db) return;

    const q = query(
      collection(this.db, 'messages'),
      orderBy('timestamp', 'asc')
    );

    onSnapshot(q, (snap) => {
      const msgs: Message[] = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          senderId: data['senderId'],
          senderName: data['senderName'],
          senderAvatar: data['senderAvatar'] || '👤',
          receiverId: data['receiverId'],
          content: data['content'],
          timestamp: data['timestamp']?.toDate()?.getTime() || Date.now(),
          mediaType: data['mediaType'],
          mediaData: data['mediaData'],
          read: data['read']
        };
      });

      this._messages$.next(msgs);
    });
  }

  private listenGroupsFirebase() {
    if (!this.db) return;
    onSnapshot(collection(this.db, 'groups'), (snap) => {
      const groups = snap.docs.map(d => d.data() as ChatGroup);
      this._groups$.next(groups);
    });
  }

  private listenInvitationsFirebase() {
    if (!this.db) return;
    onSnapshot(collection(this.db, 'invitations'), (snap) => {
      const invites = snap.docs.map(d => d.data() as Invitation);
      this._invitations$.next(invites);
    });
  }

  /* ================= MOCK ================= */

  private bootMock() {
    const savedMsgs = localStorage.getItem(this.KEY_MESSAGES);
    const savedUsers = localStorage.getItem(this.KEY_USERS);
    const savedSession = localStorage.getItem(this.KEY_SESSION);
    const savedInvites = localStorage.getItem(this.KEY_INVITATIONS);

    this.mockUsers = savedUsers ? JSON.parse(savedUsers) : [...MOCK_FRIENDS];
    this.mockInvitations = savedInvites ? JSON.parse(savedInvites) : [];
    this.mockMessages = savedMsgs ? JSON.parse(savedMsgs) : [
      {
        id: '1',
        senderId: 'rahul_01',
        senderName: 'Rahul Sharma',
        senderAvatar: '👤',
        receiverId: 'group',
        content: 'Welcome to chat!',
        timestamp: Date.now(),
        read: true
      }
    ];

    if (!savedUsers) {
      localStorage.setItem(this.KEY_USERS, JSON.stringify(this.mockUsers));
    }

    if (savedSession) {
      this._currentUser$.next(JSON.parse(savedSession) as UserProfile);
    }

    const savedGroups = localStorage.getItem(this.KEY_GROUPS);
    let parsedGroups: ChatGroup[] = savedGroups ? JSON.parse(savedGroups) : [];
    parsedGroups = parsedGroups.filter(g =>
      !g.name.toLowerCase().includes('company') &&
      !g.name.toLowerCase().includes('compant')
    );
    this.mockGroups = parsedGroups;
    localStorage.setItem(this.KEY_GROUPS, JSON.stringify(this.mockGroups));
    this._groups$.next(this.mockGroups);

    this._invitations$.next(this.mockInvitations);
    this._users$.next(this.mockUsers);
    this._messages$.next(this.mockMessages);
    this._authLoaded$.next(true);

    window.addEventListener('storage', (event) => {
      if (this.isMockMode) {
        if (event.key === this.KEY_USERS) {
          this.mockUsers = event.newValue ? JSON.parse(event.newValue) : [];
          this._users$.next([...this.mockUsers]);
        } else if (event.key === this.KEY_MESSAGES) {
          this.mockMessages = event.newValue ? JSON.parse(event.newValue) : [];
          this._messages$.next([...this.mockMessages]);
        } else if (event.key === this.KEY_GROUPS) {
          this.mockGroups = event.newValue ? JSON.parse(event.newValue) : [];
          this._groups$.next([...this.mockGroups]);
        } else if (event.key === this.KEY_INVITATIONS) {
          this.mockInvitations = event.newValue ? JSON.parse(event.newValue) : [];
          this._invitations$.next([...this.mockInvitations]);
        }
      }
    });
  }

  private saveMock() {
    localStorage.setItem(this.KEY_MESSAGES, JSON.stringify(this.mockMessages));
    localStorage.setItem(this.KEY_USERS, JSON.stringify(this.mockUsers));
    localStorage.setItem(this.KEY_INVITATIONS, JSON.stringify(this.mockInvitations));
    localStorage.setItem(this.KEY_GROUPS, JSON.stringify(this.mockGroups));
    this._messages$.next([...this.mockMessages]);
    this._users$.next([...this.mockUsers]);
    this._invitations$.next([...this.mockInvitations]);
    this._groups$.next([...this.mockGroups]);
  }

  /* ================= AUTHENTICATION ================= */

  async signUp(email: string, passwordText: string, displayName: string) {
    const emailClean = email.trim().toLowerCase();
    const password = passwordText.trim();
    const name = displayName.trim();

    if (!this.isMockMode && this.auth && this.db) {
      try {
        const cred = await createUserWithEmailAndPassword(this.auth, emailClean, password);
        await updateProfile(cred.user, { displayName: name });

        const user: UserProfile = {
          uid: cred.user.uid,
          email: emailClean,
          displayName: name,
          avatar: '👤',
          status: 'online',
          bio: 'Hey there! I am using Abhi WhatsApp.',
          lastSeen: Date.now(),
          photoURL: '👤'
        };

        await setDoc(doc(this.db, 'users', user.uid), user);
        this._currentUser$.next(user);
        return;
      } catch (err) {
        console.warn('Firebase signUp failed, falling back to mock mode:', err);
        this.isMockMode = true;
        this.bootMock();
      }
    }

    // Mock SignUp
    const exists = this.mockUsers.find(u => u.email === emailClean);
    if (exists) {
      throw new Error('Email address already in use.');
    }

    const newUser: UserProfile = {
      uid: 'u_' + Date.now(),
      email: emailClean,
      displayName: name,
      avatar: '👤',
      status: 'online',
      bio: 'Hey there! I am using Abhi WhatsApp.',
      lastSeen: Date.now(),
      password: password,
      photoURL: '👤'
    };

    this.mockUsers.push(newUser);
    this.saveMock();
    localStorage.setItem(this.KEY_SESSION, JSON.stringify(newUser));
    this._currentUser$.next(newUser);
  }

  async login(email: string, passwordText: string) {
    const emailClean = email.trim().toLowerCase();
    const password = passwordText.trim();

    if (!this.isMockMode && this.auth) {
      try {
        const cred = await signInWithEmailAndPassword(this.auth, emailClean, password);

        // Fetch user profile from Firestore
        const userSnap = await getDocs(query(collection(this.db!, 'users'), where('uid', '==', cred.user.uid)));
        if (!userSnap.empty) {
          const profile = userSnap.docs[0].data() as UserProfile;
          profile.status = 'online';
          await updateDoc(doc(this.db!, 'users', profile.uid), { status: 'online' });
          this._currentUser$.next(profile);
        } else {
          // Fallback: create Firestore profile if auth exists but firestore doc is missing
          const profile: UserProfile = {
            uid: cred.user.uid,
            email: emailClean,
            displayName: cred.user.displayName || 'User',
            avatar: '👤',
            status: 'online',
            bio: 'Hey there!',
            lastSeen: Date.now(),
            photoURL: cred.user.photoURL || '👤'
          };
          await setDoc(doc(this.db!, 'users', cred.user.uid), profile);
          this._currentUser$.next(profile);
        }
        return;
      } catch (err) {
        console.warn('Firebase login failed, falling back to mock mode:', err);
        this.isMockMode = true;
        this.bootMock();
      }
    }

    // Mock Login
    const user = this.mockUsers.find(u => u.email === emailClean);
    if (!user) {
      throw new Error('User not found. Please sign up.');
    }
    if (user.password !== password) {
      throw new Error('Incorrect password. Please try again.');
    }

    user.status = 'online';
    this.saveMock();
    localStorage.setItem(this.KEY_SESSION, JSON.stringify(user));
    this._currentUser$.next(user);
  }

  /* ================= PROFILE SETTINGS ================= */

  async updateProfileData(displayName: string, bio: string, avatar?: string, newPass?: string) {
    const me = this._currentUser$.value;
    if (!me) return;

    const nameClean = displayName.trim();
    const bioClean = bio.trim();

    if (!this.isMockMode && this.db && this.auth) {
      try {
        const user = this.auth.currentUser;
        if (user) {
          if (nameClean && nameClean !== user.displayName) {
            await updateProfile(user, { displayName: nameClean });
          }
          if (newPass && newPass.trim()) {
            await updatePassword(user, newPass.trim());
          }
        }

        const updatedProfile = {
          ...me,
          displayName: nameClean || me.displayName,
          bio: bioClean,
          avatar: avatar !== undefined ? avatar : me.avatar,
          // photoURL: avatar !== undefined ? avatar : me.avatar
        };

        const dbUpdate: any = {
          displayName: nameClean || me.displayName,
          bio: bioClean
        };
        if (avatar !== undefined) {
          dbUpdate.avatar = avatar;
          dbUpdate.photoURL = avatar;
        }

        await updateDoc(doc(this.db, 'users', me.uid), dbUpdate);
        this._currentUser$.next(updatedProfile);
        localStorage.setItem(this.KEY_SESSION, JSON.stringify(updatedProfile));
        return;
      } catch (err) {
        console.warn('Firebase profile update failed, falling back to mock mode:', err);
        this.isMockMode = true;
        this.bootMock();
      }
    }

    // Mock Update
    const u = this.mockUsers.find(x => x.uid === me.uid);
    if (u) {
      u.displayName = nameClean || u.displayName;
      u.bio = bioClean;
      if (avatar !== undefined) {
        u.avatar = avatar;
      }
      if (newPass && newPass.trim()) {
        u.password = newPass.trim();
      }
      this.saveMock();
      localStorage.setItem(this.KEY_SESSION, JSON.stringify(u));
      this._currentUser$.next(u);
    }
  }

  /* ================= SEND MESSAGE ================= */

  async sendMessage(receiverId: string, content: string, mediaType: 'text' | 'image' | 'video' | 'document' = 'text', mediaData?: string) {
    const me = this._currentUser$.value;
    if (!me) return;

    if (!this.isMockMode && this.db) {
      await addDoc(collection(this.db, 'messages'), {
        senderId: me.uid,
        senderName: me.displayName,
        senderAvatar: me.avatar || '👤',
        receiverId,
        content: content.trim(),
        mediaType,
        mediaData: mediaData || '',
        read: false,
        timestamp: serverTimestamp()
      });
      return;
    }

    // Mock Send
    const msg: Message = {
      id: 'm_' + Date.now(),
      senderId: me.uid,
      senderName: me.displayName,
      senderAvatar: me.avatar || '👤',
      receiverId,
      content: content.trim(),
      mediaType,
      mediaData: mediaData || '',
      read: false,
      timestamp: Date.now()
    };

    this.mockMessages.push(msg);
    this.saveMock();

    // Auto reply for direct messages in mock mode
    if (receiverId !== 'group') {
      setTimeout(() => {
        const replyMsg: Message = {
          id: 'm_' + (Date.now() + 1),
          senderId: receiverId,
          senderName: 'Friend',
          senderAvatar: '👤',
          receiverId: me.uid,
          content: MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)],
          mediaType: 'text',
          read: false,
          timestamp: Date.now()
        };
        this.mockMessages.push(replyMsg);
        this.saveMock();
      }, 1500);
    }
  }

  /* ================= MARK CHAT AS READ ================= */

  async markAsRead(chatId: string) {
    const me = this._currentUser$.value;
    if (!me) return;

    if (!this.isMockMode && this.db) {
      // Find unread messages from this friend
      const q = query(
        collection(this.db, 'messages'),
        where('senderId', '==', chatId),
        where('receiverId', '==', me.uid),
        where('read', '==', false)
      );
      try {
        const snap = await getDocs(q);
        const batch = writeBatch(this.db);
        snap.forEach((docSnap) => {
          batch.update(docRef(this.db!, 'messages', docSnap.id), { read: true });
        });
        await batch.commit();
      } catch (err) {
        console.error('Failed to mark read', err);
      }
      return;
    }

    // Mock read update
    let updated = false;
    this.mockMessages.forEach(m => {
      if (m.senderId === chatId && m.receiverId === me.uid && !m.read) {
        m.read = true;
        updated = true;
      }
    });
    if (updated) {
      this.saveMock();
    }
  }

  /* ================= FILTER CHAT ================= */

  async createGroup(name: string, members?: string[], avatar?: string) {
    const me = this._currentUser$.value;
    if (!me || !name.trim()) return;

    const groupName = name.trim();
    const groupMembers = members || [me.uid];
    const groupAvatar = avatar || '';

    if (!this.isMockMode && this.db) {
      try {
        const customId = 'group_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        await setDoc(doc(this.db, 'groups', customId), {
          id: customId,
          name: groupName,
          createdAt: Date.now(),
          createdBy: me.uid,
          members: groupMembers,
          avatar: groupAvatar
        });
      } catch (err) {
        console.warn('Firebase createGroup failed, falling back to mock:', err);
      }
      return;
    }

    const newGroup: ChatGroup = {
      id: 'group_' + Date.now(),
      name: groupName,
      createdAt: Date.now(),
      createdBy: me.uid,
      members: groupMembers,
      avatar: groupAvatar
    };
    this.mockGroups.push(newGroup);
    localStorage.setItem(this.KEY_GROUPS, JSON.stringify(this.mockGroups));
    this._groups$.next([...this.mockGroups]);
  }

  getMessagesForChat(chatId: string): Observable<Message[]> {
    const me = this._currentUser$.value?.uid;

    return this._messages$.pipe(
      map(msgs =>
        msgs.filter(m => {
          const isGroup = chatId === 'group' || chatId.startsWith('group_') || this._groups$.value.some(g => g.id === chatId);
          if (isGroup) {
            return m.receiverId === chatId;
          }

          return (
            (m.senderId === me && m.receiverId === chatId) ||
            (m.senderId === chatId && m.receiverId === me)
          );
        })
      )
    );
  }

  getUnreadCount(chatId: string): Observable<number> {
    const me = this._currentUser$.value?.uid;
    if (!me) return of(0);

    return this._messages$.pipe(
      map(msgs =>
        msgs.filter(m => m.senderId === chatId && m.receiverId === me && !m.read).length
      )
    );
  }

  /* ================= LOGOUT ================= */

  async logout() {
    const me = this._currentUser$.value;
    if (!this.isMockMode && this.auth) {
      if (me) {
        await this.setUserStatus(me.uid, 'offline');
      }
      await signOut(this.auth);
    } else if (me) {
      const u = this.mockUsers.find(x => x.uid === me.uid);
      if (u) {
        u.status = 'offline';
        this.saveMock();
      }
    }
    localStorage.removeItem(this.KEY_SESSION);
    localStorage.removeItem('abhi_forced_mock');
    this._currentUser$.next(null);
  }

  /* ================= INVITATIONS ACTIONS ================= */

  async sendInvitation(emailText: string) {
    const me = this._currentUser$.value;
    if (!me) throw new Error('Not logged in.');
    const targetEmail = emailText.trim().toLowerCase();
    if (targetEmail === me.email.toLowerCase()) {
      throw new Error('You cannot invite yourself.');
    }

    // Find receiver profile
    let targetUser: UserProfile | undefined;
    if (this.isMockMode) {
      targetUser = this.mockUsers.find(u => u.email.toLowerCase() === targetEmail);
    } else if (this.db) {
      const userSnap = await getDocs(query(collection(this.db, 'users'), where('email', '==', targetEmail)));
      if (!userSnap.empty) {
        targetUser = userSnap.docs[0].data() as UserProfile;
      }
    }

    if (!targetUser) {
      throw new Error('User with this email not found.');
    }

    // Check if invitation already exists
    const existing = this._invitations$.value.find(i =>
      (i.senderUid === me.uid && i.receiverUid === targetUser!.uid) ||
      (i.senderUid === targetUser!.uid && i.receiverUid === me.uid)
    );

    if (existing) {
      if (existing.status === 'accepted') {
        throw new Error('You are already connected with this user.');
      } else if (existing.status === 'pending') {
        if (existing.senderUid === me.uid) {
          throw new Error('Invitation already sent and pending.');
        } else {
          throw new Error('This user has already sent you an invitation. Check invitations.');
        }
      } else {
        // Reset status to pending
        if (this.isMockMode) {
          existing.status = 'pending';
          existing.senderUid = me.uid;
          existing.senderName = me.displayName;
          existing.senderEmail = me.email;
          existing.receiverUid = targetUser.uid;
          existing.receiverEmail = targetUser.email;
          existing.timestamp = Date.now();
          this.saveMock();
        } else if (this.db) {
          await setDoc(doc(this.db, 'invitations', existing.id), {
            status: 'pending',
            senderUid: me.uid,
            senderName: me.displayName,
            senderEmail: me.email,
            receiverUid: targetUser.uid,
            receiverEmail: targetUser.email,
            timestamp: Date.now()
          }, { merge: true });
        }
        return;
      }
    }

    // Create new invitation
    const id = this.isMockMode ? 'inv_' + Date.now() : doc(collection(this.db!, 'invitations')).id;
    const invite: Invitation = {
      id,
      senderUid: me.uid,
      senderEmail: me.email,
      senderName: me.displayName,
      receiverUid: targetUser.uid,
      receiverEmail: targetUser.email,
      status: 'pending',
      timestamp: Date.now()
    };

    if (this.isMockMode) {
      this.mockInvitations.push(invite);
      this.saveMock();
    } else if (this.db) {
      await setDoc(doc(this.db, 'invitations', id), invite);
    }
  }

  async acceptInvitation(id: string) {
    if (this.isMockMode) {
      const invite = this.mockInvitations.find(i => i.id === id);
      if (invite) {
        invite.status = 'accepted';
        this.saveMock();
      }
    } else if (this.db) {
      await updateDoc(doc(this.db, 'invitations', id), { status: 'accepted' });
    }
  }

  async rejectInvitation(id: string) {
    if (this.isMockMode) {
      const invite = this.mockInvitations.find(i => i.id === id);
      if (invite) {
        invite.status = 'rejected';
        this.saveMock();
      }
    } else if (this.db) {
      await updateDoc(doc(this.db, 'invitations', id), { status: 'rejected' });
    }
  }

  async deleteInvitation(id: string) {
    if (this.isMockMode) {
      this.mockInvitations = this.mockInvitations.filter(i => i.id !== id);
      this.saveMock();
    } else if (this.db) {
      await deleteDoc(doc(this.db, 'invitations', id));
    }
  }

  async deleteMessage(messageId: string) {
    if (this.isMockMode) {
      this.mockMessages = this.mockMessages.filter(m => m.id !== messageId);
      this.saveMock();
    } else if (this.db) {
      try {
        await deleteDoc(doc(this.db, 'messages', messageId));
      } catch (err) {
        console.error('Failed to delete message', err);
      }
    }
  }

  async updateGroup(groupId: string, name: string, members: string[], avatar?: string) {
    const groupName = name.trim();
    if (!groupName) return;
    if (this.isMockMode) {
      const g = this.mockGroups.find(x => x.id === groupId);
      if (g) {
        g.name = groupName;
        g.members = members;
        if (avatar !== undefined) {
          g.avatar = avatar;
        }
        this.saveMock();
      }
    } else if (this.db) {
      try {
        const updateData: any = {
          name: groupName,
          members: members
        };
        if (avatar !== undefined) {
          updateData.avatar = avatar;
        }
        await updateDoc(doc(this.db, 'groups', groupId), updateData);
      } catch (err) {
        console.error('Failed to update group', err);
      }
    }
  }

  async deleteGroup(groupId: string) {
    if (this.isMockMode) {
      this.mockGroups = this.mockGroups.filter(g => g.id !== groupId);
      this.saveMock();
    } else if (this.db) {
      try {
        await deleteDoc(doc(this.db, 'groups', groupId));
      } catch (err) {
        console.error('Failed to delete group', err);
      }
    }
  }

  async leaveGroup(groupId: string) {
    const me = this._currentUser$.value?.uid;
    if (!me) return;

    if (this.isMockMode) {
      this.mockGroups = this.mockGroups.map(g => {
        if (g.id === groupId) {
          return {
            ...g,
            members: g.members ? g.members.filter(m => m !== me) : []
          };
        }
        return g;
      });
      // Filter out group if the user is no longer a member
      this.mockGroups = this.mockGroups.filter(g => g.members?.includes(me));
      this.saveMock();
    } else if (this.db) {
      try {
        const groupRef = doc(this.db, 'groups', groupId);
        await updateDoc(groupRef, {
          members: arrayRemove(me)
        });
      } catch (err) {
        console.error('Failed to leave group', err);
      }
    }
  }

  async deleteFriend(friendUid: string) {
    const me = this._currentUser$.value;
    if (!me) return;
    if (this.isMockMode) {
      this.mockInvitations = this.mockInvitations.filter(i =>
        !((i.senderUid === me.uid && i.receiverUid === friendUid && i.status === 'accepted') ||
          (i.senderUid === friendUid && i.receiverUid === me.uid && i.status === 'accepted'))
      );
      this.saveMock();
    } else if (this.db) {
      try {
        const q = query(
          collection(this.db, 'invitations'),
          where('status', '==', 'accepted')
        );
        const snap = await getDocs(q);
        const batch = writeBatch(this.db);
        let count = 0;
        snap.forEach((docSnap) => {
          const data = docSnap.data() as Invitation;
          if ((data.senderUid === me.uid && data.receiverUid === friendUid) ||
            (data.senderUid === friendUid && data.receiverUid === me.uid)) {
            batch.delete(docRef(this.db!, 'invitations', docSnap.id));
            count++;
          }
        });
        if (count > 0) {
          await batch.commit();
        }
      } catch (err) {
        console.error('Failed to delete friend connection', err);
      }
    }
  }
}

// Helper function because direct DocRef import can be messy
function docRef(db: Firestore, col: string, id: string) {
  return doc(db, col, id);
}