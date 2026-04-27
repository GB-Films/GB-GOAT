import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { doc, getDocFromCache, getDocFromServer } from 'firebase/firestore';
import App from './App.tsx';
import './index.css';
import { db } from './lib/firebase';

async function testConnection() {
  try {
    // Try to get a dummy doc to verify connection
    await getDocFromServer(doc(db, 'system', 'health'));
  } catch (error: any) {
    if (error.message?.includes('the client is offline') || error.message?.includes('insufficient permissions')) {
      console.warn("Firebase Connection Info:", error.message);
    }
  }
}
testConnection();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
