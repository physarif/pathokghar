// firebase.js — Pathok Ghar Auth
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const firebaseConfig = {
  apiKey:            'AIzaSyCN0PqjGG78r6IGKJz7D53xhfllqwFhBo0',
  authDomain:        'pathokghar.firebaseapp.com',
  databaseURL:       'https://pathokghar-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:         'pathokghar',
  storageBucket:     'pathokghar.firebasestorage.app',
  messagingSenderId: '367068410598',
  appId:             '1:367068410598:web:3be0af281acf767a448127',
  measurementId:     'G-WFBP0HJMJV',
};

const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const provider = new GoogleAuthProvider();

// Auth state — layout.html এর callbacks call করে
onAuthStateChanged(auth, user => {
  if (user) {
    window.onAuthLogin?.(user);
  } else {
    window.onAuthLogout?.();
  }
});

// Global functions — layout.html থেকে call হয়
window.googleLogin = async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error('Login error:', e.message);
  }
};

window.doLogout = async () => {
  try {
    await signOut(auth);
  } catch (e) {
    console.error('Logout error:', e.message);
  }
};
