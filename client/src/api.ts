import {
  Role,
  RuntimeState,
  AffectiveState,
  ScheduleData,
  ClientMessage,
  ChatSession,
  AuthUser,
} from "./types";
import { Platform } from "react-native";

// Resolve API host dynamically: on web browser use location hostname, on mobile use localhost or LAN IP
const getApiBaseUrl = (): string => {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location) {
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }
  return "http://localhost:3000";
};

export const API_BASE = getApiBaseUrl();

let inMemoryUser: AuthUser | null = null;

export const getStoredUser = (): AuthUser | null => {
  if (inMemoryUser) return inMemoryUser;
  if (Platform.OS === "web" && typeof window !== "undefined" && window.localStorage) {
    try {
      const saved = window.localStorage.getItem("agy_auth_user");
      if (saved) {
        inMemoryUser = JSON.parse(saved);
        return inMemoryUser;
      }
    } catch {
      // ignore
    }
  }
  return null;
};

export const setStoredUser = (user: AuthUser | null) => {
  inMemoryUser = user;
  if (Platform.OS === "web" && typeof window !== "undefined" && window.localStorage) {
    try {
      if (user) {
        window.localStorage.setItem("agy_auth_user", JSON.stringify(user));
      } else {
        window.localStorage.removeItem("agy_auth_user");
      }
    } catch {
      // ignore
    }
  }
};

export const getWsBaseUrl = (user?: AuthUser | null): string => {
  const activeUser = user || getStoredUser();
  const query = activeUser ? `?userId=${activeUser.userId}&chatId=${activeUser.chatId || activeUser.userId}` : "";
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.hostname}:3000/ws/chat${query}`;
  }
  return `ws://localhost:3000/ws/chat${query}`;
};

const getHeaders = () => {
  const user = getStoredUser();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (user?.userId) {
    headers["x-user-id"] = String(user.userId);
    headers["x-chat-id"] = String(user.chatId || user.userId);
  }
  if (user?.token) {
    headers["Authorization"] = `Bearer ${user.token}`;
  }
  return headers;
};

export const api = {
  // Auth & Telegram Bind
  async verifyBindCode(code: string): Promise<{ ok: boolean; user?: AuthUser; token?: string; error?: string }> {
    const res = await fetch(`${API_BASE}/api/auth/verify-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (data.ok && data.user) {
      setStoredUser({ ...data.user, token: data.token });
    }
    return data;
  },

  async createGuestUser(): Promise<{ ok: boolean; user?: AuthUser; token?: string; error?: string }> {
    const res = await fetch(`${API_BASE}/api/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (data.ok && data.user) {
      setStoredUser({ ...data.user, token: data.token });
    }
    return data;
  },

  async getMe(): Promise<AuthUser | null> {
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, { headers: getHeaders() });
      const data = await res.json();
      return data.ok && data.user ? data.user : null;
    } catch {
      return null;
    }
  },

  logout() {
    setStoredUser(null);
  },

  // Roles & Character State
  async getRoles(): Promise<Role[]> {
    const res = await fetch(`${API_BASE}/api/roles`, { headers: getHeaders() });
    const data = await res.json();
    return data.ok ? data.roles : [];
  },

  async getRole(name: string): Promise<any> {
    const res = await fetch(`${API_BASE}/api/roles/${encodeURIComponent(name)}`, { headers: getHeaders() });
    return res.json();
  },

  async getState(name: string): Promise<{
    isSleeping: boolean;
    runtimeState: RuntimeState | null;
    affectiveState: AffectiveState | null;
  }> {
    const res = await fetch(`${API_BASE}/api/roles/${encodeURIComponent(name)}/state`, { headers: getHeaders() });
    const data = await res.json();
    return {
      isSleeping: data.isSleeping || false,
      runtimeState: data.runtimeState || null,
      affectiveState: data.affectiveState || null,
    };
  },

  async getSchedule(name: string): Promise<ScheduleData | null> {
    const res = await fetch(`${API_BASE}/api/roles/${encodeURIComponent(name)}/schedule`, { headers: getHeaders() });
    const data = await res.json();
    return data.ok ? data : null;
  },

  async caffeineWake(name: string): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/api/roles/${encodeURIComponent(name)}/caffeine`, {
      method: "POST",
      headers: getHeaders(),
    });
    return res.json();
  },

  async resetRole(name: string): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/api/roles/${encodeURIComponent(name)}/reset`, {
      method: "POST",
      headers: getHeaders(),
    });
    return res.json();
  },

  // Chat
  async getSession(): Promise<ChatSession | null> {
    const res = await fetch(`${API_BASE}/api/chat/session`, { headers: getHeaders() });
    const data = await res.json();
    return data.ok ? data.session : null;
  },

  async switchRole(roleName: string): Promise<{ ok: boolean; session?: ChatSession }> {
    const res = await fetch(`${API_BASE}/api/chat/switch`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ roleName }),
    });
    return res.json();
  },

  async getMessages(): Promise<ClientMessage[]> {
    const res = await fetch(`${API_BASE}/api/chat/messages`, { headers: getHeaders() });
    const data = await res.json();
    return data.ok ? data.messages : [];
  },

  async sendMessage(text: string, roleName?: string): Promise<{ ok: boolean; reply?: string; message?: ClientMessage; error?: string }> {
    const res = await fetch(`${API_BASE}/api/chat/send`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ text, roleName }),
    });
    return res.json();
  },

  async clearChat(): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/api/chat/clear`, {
      method: "POST",
      headers: getHeaders(),
    });
    return res.json();
  },
};
