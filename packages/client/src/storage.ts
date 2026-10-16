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

/** Jeton d'identité persistant, pour reprendre sa place après reconnexion. */
export function getToken(): string {
  let token = load('dm-token');
  if (!token) {
    token = crypto.randomUUID();
    save('dm-token', token);
  }
  return token;
}
