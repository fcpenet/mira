export type UserRole = 'admin' | 'operator' | 'viewer';
export type DeviceType = 'sensor' | 'camera';
export type DeviceStatus = 'online' | 'offline';
export type EventSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AuthUser {
  id: string;
  orgId: string;
  role: UserRole;
  email: string;
}

export interface Device {
  id: string;
  org_id: string;
  name: string;
  type: DeviceType;
  status: DeviceStatus;
  api_key?: string;
  last_seen: string | null;
  created_at: string;
}

export interface Event {
  id: string;
  org_id: string;
  device_id: string;
  type: string;
  severity: EventSeverity;
  payload: Record<string, unknown>;
  created_at: string;
}

// Augment Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
