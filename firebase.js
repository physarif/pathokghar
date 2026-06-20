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

// UI elements
const loggedOut   = document.getElementById('sb-logged-out');
const loggedIn    = document.getElementById('sb-logged-in');
const userPhoto   = document.getElementById('sb-user-photo');
const userName    = document.getElementById('sb-user-name');
const userEmail   = document.getElementById('sb-user-email');
const loginBtn    = document.getElementById('sb-google-login');
const logoutBtn   = document.getElementById('sb-logout');

// Auth state
onAuthStateChanged(auth, user => {
  if (user) {
    userPhoto.src    = user.photoURL || '';
    userName.textContent  = user.displayName || 'ব্যবহারকারী';
    userEmail.textContent = user.email || '';
    loggedOut.classList.add('hidden');
    loggedIn.classList.remove('hidden');
  } else {
    loggedOut.classList.remove('hidden');
    loggedIn.classList.add('hidden');
  }
});

// Login
loginBtn?.addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error('Login error:', e.message);
  }
});

// Logout
logoutBtn?.addEventListener('click', async () => {
  try {
    await signOut(auth);
  } catch (e) {
    console.error('Logout error:', e.message);
  }
});
  
