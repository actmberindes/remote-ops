import { Router } from 'express';
import { db, nextId, nextTicketNumber } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { assignAssetToEmployee } from './assets.js';

export const ticketsRouter = Router();
ticketsRouter.use(requireAuth(db));

const STATUSES = ['Open', 'In Progress', 'Pending', 'Resolved', 'Closed'];

function userName(id) {
  const u = db.data.users.find(x => x.id === id);
  return u ? u.name : 'Unknown';
}

function teamIdsOf(managerId) {
  return new Set(db.data.users.filter(u => u.managerId === managerId).map(u => u.id));
}

function canView(user, ticket) {
  if (user.role === 'Admin') return true;
  if (user.role === 'Manager') return teamIdsOf(user.id).has(ticket.employeeId);
  return ticket.employeeId === user.id;
}

function enrich(ticket) {
  return {
    ...ticket,
    employeeName: userName(ticket.employeeId),
    assignedToName: ticket.assignedTo ? userName(ticket.assignedTo) : null,
    messageCount: db.data.ticketMessages.filter(m => m.ticketId === ticket.id).length,
  };
}

ticketsRouter.get('/', (req, res) => {
  let all;
  if (req.user.role === 'Employee') {
    all = db.data.tickets.filter(t => t.employeeId === req.user.id);
  } else if (req.user.role === 'Manager') {
    const teamIds = teamIdsOf(req.user.id);
    all = db.data.tickets.filter(t => teamIds.has(t.employeeId));
  } else {
    all = db.data.tickets;
  }
  res.json(all.map(enrich).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
});

ticketsRouter.post('/', async (req, res) => {
  const { subject, description, type, priority, attachment } = req.body || {};
  if (!subject || !description) return res.status(400).json({ error: 'Subject and description are required.' });
  if (!['Request', 'Borrow', 'Incident'].includes(type)) return res.status(400).json({ error: 'Type must be Request, Borrow, or Incident.' });
  if (!['Low', 'Medium', 'High', 'Urgent'].includes(priority)) return res.status(400).json({ error: 'Priority must be Low, Medium, High, or Urgent.' });

  const now = new Date().toLocaleString('en-US');
  const ticket = {
    id: nextId(), ticketNumber: nextTicketNumber(), employeeId: req.user.id, assignedTo: null,
    subject, description, type, priority, status: 'Open', createdAt: now, updatedAt: now,
  };
  db.data.tickets.push(ticket);

  if (attachment?.url) {
    db.data.ticketAttachments.push({ id: nextId(), ticketId: ticket.id, filename: attachment.filename || 'attachment', path: attachment.url });
  }

  // Every ticket starts with a system message confirming submission, so the thread is never empty.
  db.data.ticketMessages.push({
    id: nextId(), ticketId: ticket.id, sender: req.user.id, senderRole: 'System',
    message: `Ticket ${ticket.ticketNumber} created by ${req.user.name}. Status set to Open — a team member will follow up shortly.`,
    attachment: null, createdAt: now,
  });

  db.data.notifications.push({
    id: nextId(), audience: 'role', role: 'Admin',
    message: `New ${type.toLowerCase()} ticket ${ticket.ticketNumber} from ${req.user.name}: "${subject}"`,
    type: 'info', read: false, timestamp: now,
  });
  if (req.user.managerId) {
    db.data.notifications.push({
      id: nextId(), audience: 'user', userId: req.user.managerId,
      message: `${req.user.name} opened ticket ${ticket.ticketNumber}: "${subject}"`,
      type: 'info', read: false, timestamp: now,
    });
  }

  await db.write();
  res.status(201).json(enrich(ticket));
});

ticketsRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.data.tickets.find(t => t.id === id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
  if (!canView(req.user, ticket)) return res.status(403).json({ error: 'You do not have access to this ticket.' });

  const messages = db.data.ticketMessages.filter(m => m.ticketId === id)
    .map(m => ({ ...m, senderName: userName(m.sender) }))
    .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
  const attachments = db.data.ticketAttachments.filter(a => a.ticketId === id);

  res.json({ ...enrich(ticket), messages, attachments });
});

ticketsRouter.post('/:id/messages', async (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.data.tickets.find(t => t.id === id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

  const isOwner = ticket.employeeId === req.user.id;
  const canReply = isOwner || req.user.role === 'Admin' || (req.user.role === 'Manager' && teamIdsOf(req.user.id).has(ticket.employeeId));
  if (!canReply) return res.status(403).json({ error: 'You do not have access to this ticket.' });
  if (ticket.status === 'Closed') return res.status(409).json({ error: 'This ticket is closed and no longer accepting replies.' });

  const { message, attachment } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message cannot be empty.' });

  const now = new Date().toLocaleString('en-US');
  const entry = {
    id: nextId(), ticketId: id, sender: req.user.id, senderRole: req.user.role,
    message: message.trim(), attachment: attachment?.url || null, createdAt: now,
  };
  db.data.ticketMessages.push(entry);
  ticket.updatedAt = now;

  if (!isOwner) {
    db.data.notifications.push({
      id: nextId(), audience: 'user', userId: ticket.employeeId,
      message: `${req.user.name} replied on your ticket ${ticket.ticketNumber}.`, type: 'info', read: false, timestamp: now,
    });
  }

  await db.write();
  res.status(201).json({ ...entry, senderName: req.user.name });
});

// Employee self-service: close their own ticket (no status escalation privileges beyond this).
ticketsRouter.patch('/:id/close', requireRole('Employee'), async (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.data.tickets.find(t => t.id === id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
  if (ticket.employeeId !== req.user.id) return res.status(403).json({ error: 'You can only close your own tickets.' });
  if (ticket.status === 'Closed') return res.status(409).json({ error: 'This ticket is already closed.' });

  ticket.status = 'Closed';
  ticket.updatedAt = new Date().toLocaleString('en-US');
  await db.write();
  res.json(enrich(ticket));
});

// Admin: full status control + assigning an admin to the ticket.
ticketsRouter.patch('/:id', requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.data.tickets.find(t => t.id === id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

  const { status, assignedTo } = req.body || {};
  if (status !== undefined) {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: `Status must be one of ${STATUSES.join(', ')}.` });
    ticket.status = status;
  }
  if (assignedTo !== undefined) {
    if (assignedTo === null) {
      ticket.assignedTo = null;
    } else {
      const assignee = db.data.users.find(u => u.id === Number(assignedTo));
      if (!assignee || assignee.role !== 'Admin') return res.status(400).json({ error: 'Tickets can only be assigned to an Admin user.' });
      ticket.assignedTo = assignee.id;
    }
  }
  ticket.updatedAt = new Date().toLocaleString('en-US');

  db.data.notifications.push({
    id: nextId(), audience: 'user', userId: ticket.employeeId,
    message: `Your ticket ${ticket.ticketNumber} was updated to "${ticket.status}".`, type: 'info', read: false, timestamp: ticket.updatedAt,
  });

  await db.write();
  res.json(enrich(ticket));
});

// Cross-module integration: approving a Borrow ticket lets the admin one-click assign an asset,
// which closes the ticket and logs the item under the employee's assigned assets.
ticketsRouter.post('/:id/assign-asset', requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.data.tickets.find(t => t.id === id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
  if (ticket.type !== 'Borrow') return res.status(400).json({ error: 'Only Borrow-type tickets support one-click asset assignment.' });
  if (ticket.status === 'Closed') return res.status(409).json({ error: 'This ticket is already closed.' });

  const { assetId } = req.body || {};
  if (!assetId) return res.status(400).json({ error: 'assetId is required.' });

  try {
    const { asset } = assignAssetToEmployee(Number(assetId), ticket.employeeId, req.user.id);
    const now = new Date().toLocaleString('en-US');
    ticket.status = 'Closed';
    ticket.updatedAt = now;
    db.data.ticketMessages.push({
      id: nextId(), ticketId: id, sender: req.user.id, senderRole: 'Admin',
      message: `${asset.name} (${asset.assetTag}) has been assigned to fulfill this request. Ticket closed.`,
      attachment: null, createdAt: now,
    });
    await db.write();
    res.json(enrich(ticket));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});
