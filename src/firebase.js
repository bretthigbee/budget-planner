import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "firebase/firestore";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBodkDrY3tWGsNprZinc87VubwVRFl4o6Q",
  authDomain: "budget-planner-9911c.firebaseapp.com",
  projectId: "budget-planner-9911c",
  storageBucket: "budget-planner-9911c.firebasestorage.app",
  messagingSenderId: "898249309651",
  appId: "1:898249309651:web:b3d650b5a2a1a0693c0326",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export function signInWithGoogle() {
  return signInWithPopup(auth, provider);
}

export function logOut() {
  return signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// Save user data to Firestore
export async function saveUserData(uid, data) {
  await setDoc(doc(db, "users", uid), data, { merge: true });
}

// Load user data from Firestore
export async function loadUserData(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// Real-time listener for user data
export function onUserDataChange(uid, callback) {
  return onSnapshot(doc(db, "users", uid), (snap) => {
    if (snap.exists()) callback(snap.data());
  });
}
