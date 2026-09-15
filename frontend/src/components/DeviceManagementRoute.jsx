import React, { useEffect, useState } from 'react';
import AdminDeviceManagementPanel from './AdminDeviceManagementPanel.jsx';
import ManagerDeviceManagementPage from './ManagerDeviceManagementPage.jsx';
import { api } from '../lib/api.js';

export default function DeviceManagementRoute() {
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.me()
      .then(async response => {
        if (!active) return;
        const currentUser = response?.user || response;
        setMe(currentUser);
        if (currentUser?.role === 'Admin') {
          const userList = await api.users.list();
          if (active) setUsers(Array.isArray(userList) ? userList : []);
        }
      })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);

  if (error) return <div className="card p-6 text-sm text-[var(--danger)]">Unable to load Device Management: {error}</div>;
  if (!me) return <div className="py-16 text-center text-sm text-muted">Loading Device Management…</div>;
  if (me.role === 'Manager') return <ManagerDeviceManagementPage />;
  if (me.role === 'Admin') return <AdminDeviceManagementPanel users={users} />;
  return <div className="card p-6 text-sm text-muted">You do not have access to Device Management.</div>;
}
