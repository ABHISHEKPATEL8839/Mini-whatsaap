import { Component, Output, EventEmitter, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './auth.html',
  styleUrl:    './auth.css',
})
export class AuthComponent {
  @Output() loginSuccess = new EventEmitter<void>();

  // Form Signals
  email    = signal('');
  name     = signal('');
  password = signal('');
  avatar   = signal('👤');

  isSignUp     = signal(true); // Toggle between SignUp and Login
  loading      = signal(false);
  error        = signal('');
  showPassword = signal(false);

  constructor(private svc: FirebaseService) {}

  toggleMode() {
    this.isSignUp.update(val => !val);
    this.error.set('');
    this.email.set('');
    this.password.set('');
    this.name.set('');
    this.avatar.set('👤');
    this.showPassword.set(false);
  }

  togglePasswordVisibility() {
    this.showPassword.update(val => !val);
  }

  async submit() {
    const e = this.email().trim();
    const p = this.password().trim();
    const n = this.name().trim();

    if (!e || !e.includes('@')) {
      this.error.set('Please enter a valid email address.');
      return;
    }
    if (!p || p.length < 6) {
      this.error.set('Password must be at least 6 characters.');
      return;
    }

    if (this.isSignUp()) {
      if (!n || n.length < 2) {
        this.error.set('Name must be at least 2 characters.');
        return;
      }
    }

    this.loading.set(true);
    this.error.set('');

    try {
      if (this.isSignUp()) {
        await this.svc.signUp(e, p, n);
      } else {
        await this.svc.login(e, p);
      }
      this.loginSuccess.emit();
    } catch (err: any) {
      console.error(err);
      this.error.set(err.message || 'Authentication failed. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
