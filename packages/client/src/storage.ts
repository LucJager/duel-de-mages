// localStorage peut être indisponible (navigation privée) : on échoue en silence.
export function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignoré
  }
}

/** Salle en cours, par onglet (sessionStorage). `null` l'efface. */
export function sessionRoom(code?: string | null): string | null {
  try {
    if (code === null) sessionStorage.removeItem('dm-room');
    else if (code) sessionStorage.setItem('dm-room', code);
    return sessionStorage.getItem('dm-room');
  } catch {
    return null;
  }
}

/** Jeton d'identité persistant, pour reprendre sa place après reconnexion. */
export function getToken(): string {
  let token = load('dm-token');
  if (!token) {
    // randomUUID n'existe qu'en contexte sécurisé (https ou localhost)
    token = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
    save('dm-token', token);
  }
  return token;
}
