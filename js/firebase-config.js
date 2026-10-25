
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDloJ2Ra8xN1IvUD0yj7aU_BjF_-2Fq7fE",
  authDomain: "cuuhocsinh126.firebaseapp.com",
  databaseURL: "https://cuuhocsinh126-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "cuuhocsinh126",
  storageBucket: "cuuhocsinh126.firebasestorage.app",
  messagingSenderId: "214410037671",
  appId: "1:214410037671:web:c9555a1b530ebebb78ce82"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
