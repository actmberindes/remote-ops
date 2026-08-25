import { Router } from 'express';
import { db, nextId, nextAssetTag } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

export const assetsRouter = Router();
assetsRouter.use(requireAuth(db));

function userName(id) {
  const u = db.data.users.find(x => x.id === id);
  return u ? u.name : 'Unknown';
}

function teamIdsOf(managerId) {
  return new Set(db.data.users.filter(u => u.managerId === managerId).map(u => u.id));
}

function activeAssignmentsFor(assetId) {
  return db.data.assetAssignments.filter(a => a.assetId === assetId && a.status === 'Active');
}

function activeUpsAssignment(upsAssetId) {
  return activeAssignmentsFor(upsAssetId)[0] || null;
}

function isQuantityAsset(asset) {
  return asset.quantity !== null && asset.quantity !== undefined;
}

function isUpsBattery(asset) {
  return asset?.type === 'UPS Battery';
}

function batteryAssignmentsFor(assetId) {
  return db.data.assetAssignments.filter(a => a.assetId === assetId && a.status === 'Active');
}

function assignmentEmployee(asset, assignment) {
  if (!assignment) return null;
  if (isUpsBattery(asset) && assignment.upsAssetId) {
    const upsAssignment = activeUpsAssignment(assignment.upsAssetId);
    if (!upsAssignment) return null;
    return { employeeId: upsAssignment.employeeId, employeeName: userName(upsAssignment.employeeId), assignedDate: assignment.assignedDate, upsAssetId: assignment.upsAssetId };
  }
  if (assignment.employeeId === null || assignment.employeeId === undefined) return null;
  return { employeeId: assignment.employeeId, employeeName: userName(assignment.employeeId), assignedDate: assignment.assignedDate };
}

function enrichAsset(asset) {
  const active = activeAssignmentsFor(asset.id);
  const assignees = active.map(a => assignmentEmployee(asset, a)).filter(Boolean);
  const hasQuantity = isQuantityAsset(asset);
  return {
    ...asset,
    currentAssignment: assignees[0] || null,
    assignees,
    assignedCount: assignees.length,
    quantityAvailable: hasQuantity ? Math.max(0, Number(asset.quantity) - active.length) : null,
  };
}

function logAction(assetId, action, performedBy, message) {
  db.data.assetLogs.push({ id: nextId(), assetId, action, performedBy, message, timestamp: new Date().toLocaleString('en-US') });
}

function recomputeStockStatus(asset) {
  if (!isQuantityAsset(asset)) return;
  const activeCount = activeAssignmentsFor(asset.id).length;
  const available = Math.max(0, Number(asset.quantity) - activeCount);
  const wasOutOfStock = asset.status === 'Out of Stock';

  if (available <= 0 && asset.status !== 'Retired') {
    asset.status = 'Out of Stock';
    if (!wasOutOfStock) {
      db.data.notifications.push({
        id: nextId(), audience: 'role', role: 'Admin',
        message: `${asset.name} (${asset.assetTag}) is now out of stock.`, type: 'warning', read: false,
        timestamp: new Date().toLocaleString('en-US'),
      });
    }
  } else if (wasOutOfStock && available > 0) {
    asset.status = 'Available';
  }
}

function notifyAssigned(asset, employeeId) {
  if (!employeeId) return;
  db.data.notifications.push({
    id: nextId(), audience: 'user', userId: employeeId,
    message: `${asset.name} (${asset.assetTag}) has been assigned to you.`, type: 'success', read: false,
    timestamp: new Date().toLocaleString('en-US'),
  });
}

export function assignAssetToEmployee(assetId, employeeId, assignedBy) {
  const asset = db.data.assets.find(a => a.id === assetId);
  if (!asset) throw Object.assign(new Error('Asset not found.'), { status: 404 });
  if (isUpsBattery(asset)) throw Object.assign(new Error('UPS Battery must be assigned to a UPS, not directly to an employee.'), { status: 400 });

  const employee = db.data.users.find(u => u.id === employeeId);
  if (!employee) throw Object.assign(new Error('Employee not found.'), { status: 404 });

  const hasQuantity = isQuantityAsset(asset);
  const active = activeAssignmentsFor(assetId);

  if (hasQuantity) {
    if (Number(asset.quantity) - active.length <= 0) throw Object.assign(new Error('This item is out of stock.'), { status: 409 });
    if (active.some(a => a.employeeId === employeeId)) throw Object.assign(new Error('Already assigned to this employee.'), { status: 409 });
  } else if (active.length > 0) {
    throw Object.assign(new Error('Asset is not currently available for assignment.'), { status: 409 });
  }

  const assignment = { id: nextId(), assetId, employeeId, assignedBy, assignedDate: new Date().toISOString().slice(0, 10), returnedDate: null, status: 'Active' };
  db.data.assetAssignments.push(assignment);

  if (hasQuantity) recomputeStockStatus(asset);
  else asset.status = 'In Use';
  logAction(assetId, 'Assigned', assignedBy, `Assigned to ${employee.name} by ${userName(assignedBy)}.`);
  notifyAssigned(asset, employeeId);

  return { asset, assignment };
}

assetsRouter.get('/', (req, res) => {
  if (req.user.role === 'Employee') {
    const mineIds = new Set(db.data.assetAssignments.filter(a => a.status === 'Active' && a.employeeId === req.user.id).map(a => a.assetId));
    const mineBatteryIds = new Set(db.data.assetAssignments.filter(a => a.status === 'Active' && a.upsAssetId && activeUpsAssignment(a.upsAssetId)?.employeeId === req.user.id).map(a => a.assetId));
    return res.json(db.data.assets.filter(a => mineIds.has(a.id) || mineBatteryIds.has(a.id)).map(enrichAsset));
  }
  if (req.user.role === 'Manager') {
    const teamIds = teamIdsOf(req.user.id);
    const teamAssetIds = new Set(db.data.assetAssignments.filter(a => a.status === 'Active' && teamIds.has(a.employeeId)).map(a => a.assetId));
    const teamBatteryIds = new Set(db.data.assetAssignments.filter(a => a.status === 'Active' && a.upsAssetId && teamIds.has(activeUpsAssignment(a.upsAssetId)?.employeeId)).map(a => a.assetId));
    return res.json(db.data.assets.filter(a => teamAssetIds.has(a.id) || teamBatteryIds.has(a.id)).map(enrichAsset));
  }
  res.json(db.data.assets.map(enrichAsset));
});

assetsRouter.get('/ups-options', requireRole('Admin'), (req, res) => {
  const options = db.data.assets
    .filter(a => a.type === 'UPS')
    .map(ups => {
      const assignment = activeUpsAssignment(ups.id);
      return {
        id: ups.id,
        assetTag: ups.assetTag,
        name: ups.name,
        serialNumber: ups.serialNumber || '',
        assignedEmployeeId: assignment?.employeeId || null,
        assignedEmployeeName: assignment ? userName(assignment.employeeId) : null,
        display: `${ups.serialNumber || ups.assetTag}${assignment ? ` - ${userName(assignment.employeeId)}` : ' - Unassigned'}`,
      };
    })
    .filter(x => x.assignedEmployeeId);
  res.json(options);
});

assetsRouter.post('/', requireRole('Admin'), async (req, res) => {
  const { name, type, brand, model, serialNumber, purchaseDate, warrantyExpiry, remarks, specs, imageUrl, quantity, cost } = req.body || {};
  if (!name || !type) return res.status(400).json({ error: 'Asset name and type are required.' });

  const hasQuantity = quantity !== undefined && quantity !== null && quantity !== '';
  if (hasQuantity && (!Number.isInteger(Number(quantity)) || Number(quantity) < 0)) {
    return res.status(400).json({ error: 'Quantity must be a whole number 0 or greater.' });
  }
  const numericCost = cost === undefined || cost === null || cost === '' ? null : Number(cost);
  if (numericCost !== null && (!Number.isFinite(numericCost) || numericCost < 0)) {
    return res.status(400).json({ error: 'Cost must be a valid number 0 or greater.' });
  }

  const asset = {
    id: nextId(), name, type, assetTag: nextAssetTag(type), brand: brand || '', model: model || '',
    serialNumber: serialNumber || '', purchaseDate: purchaseDate || '', warrantyExpiry: warrantyExpiry || '',
    cost: numericCost,
    status: 'Available', remarks: remarks || '', specs: (specs && typeof specs === 'object') ? specs : {}, imageUrl: imageUrl || null,
    quantity: hasQuantity ? Number(quantity) : null,
  };
  if (hasQuantity && asset.quantity === 0) asset.status = 'Out of Stock';

  db.data.assets.push(asset);
  logAction(asset.id, 'Created', req.user.id, `${asset.name} (${asset.assetTag}) was added to inventory by ${req.user.name}.`);
  await db.write();
  res.status(201).json(enrichAsset(asset));
});

assetsRouter.post('/:id/clone', requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const source = db.data.assets.find(a => a.id === id);
  if (!source) return res.status(404).json({ error: 'Asset not found.' });

  const clone = {
    ...source,
    id: nextId(),
    assetTag: nextAssetTag(source.type),
    serialNumber: '',
    status: isQuantityAsset(source) && Number(source.quantity) === 0 ? 'Out of Stock' : 'Available',
    remarks: source.remarks || '',
  };

  db.data.assets.push(clone);
  logAction(clone.id, 'Cloned', req.user.id, `${clone.name} (${clone.assetTag}) was cloned from ${source.assetTag} by ${req.user.name}.`);
  await db.write();
  res.status(201).json(enrichAsset(clone));
});

assetsRouter.put('/:id', requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const asset = db.data.assets.find(a => a.id === id);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });

  const { name, type, brand, model, serialNumber, purchaseDate, warrantyExpiry, remarks, specs, imageUrl, quantity, cost } = req.body || {};
  if (name !== undefined) asset.name = name;
  if (type !== undefined) asset.type = type;
  if (brand !== undefined) asset.brand = brand;
  if (model !== undefined) asset.model = model;
  if (serialNumber !== undefined) asset.serialNumber = serialNumber;
  if (purchaseDate !== undefined) asset.purchaseDate = purchaseDate;
  if (warrantyExpiry !== undefined) asset.warrantyExpiry = warrantyExpiry;
  if (remarks !== undefined) asset.remarks = remarks;
  if (specs !== undefined && typeof specs === 'object') asset.specs = specs;
  if (imageUrl !== undefined) asset.imageUrl = imageUrl;
  if (cost !== undefined) {
    const numericCost = cost === null || cost === '' ? null : Number(cost);
    if (numericCost !== null && (!Number.isFinite(numericCost) || numericCost < 0)) {
      return res.status(400).json({ error: 'Cost must be a valid number 0 or greater.' });
    }
    asset.cost = numericCost;
  }
  if (quantity !== undefined) {
    const hasQuantity = quantity !== null && quantity !== '';
    if (hasQuantity && (!Number.isInteger(Number(quantity)) || Number(quantity) < 0)) {
      return res.status(400).json({ error: 'Quantity must be a whole number 0 or greater.' });
    }
    asset.quantity = hasQuantity ? Number(quantity) : null;
    recomputeStockStatus(asset);
  }

  logAction(id, 'Edited', req.user.id, `${asset.name} (${asset.assetTag}) details were updated by ${req.user.name}.`);
  await db.write();
  res.json(enrichAsset(asset));
});

assetsRouter.delete('/:id', requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const asset = db.data.assets.find(a => a.id === id);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });
  if (activeAssignmentsFor(id).length > 0) return res.status(409).json({ error: 'This asset is currently assigned. Return it before deleting.' });

  db.data.assets = db.data.assets.filter(a => a.id !== id);
  logAction(id, 'Deleted', req.user.id, `${asset.name} (${asset.assetTag}) was removed from inventory by ${req.user.name}.`);
  await db.write();
  res.json({ ok: true });
});

assetsRouter.post('/:id/assign', requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const { employeeId } = req.body || {};
  if (!employeeId) return res.status(400).json({ error: 'employeeId is required.' });
  try {
    const { asset } = assignAssetToEmployee(id, Number(employeeId), req.user.id);
    await db.write();
    res.json(enrichAsset(asset));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

assetsRouter.post('/:id/assign-battery', requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const { upsAssetId } = req.body || {};
  const battery = db.data.assets.find(a => a.id === id);
  if (!battery) return res.status(404).json({ error: 'Asset not found.' });
  if (!isUpsBattery(battery)) return res.status(400).json({ error: 'Only UPS Battery assets can use this assignment method.' });
  if (!upsAssetId) return res.status(400).json({ error: 'upsAssetId is required.' });
  if (!isQuantityAsset(battery)) return res.status(400).json({ error: 'UPS Battery quantity must be configured before assignment.' });

  const ups = db.data.assets.find(a => a.id === Number(upsAssetId));
  if (!ups || ups.type !== 'UPS') return res.status(400).json({ error: 'Please select a valid UPS asset.' });
  const upsAssignment = activeUpsAssignment(ups.id);
  if (!upsAssignment) return res.status(409).json({ error: 'The selected UPS is not currently assigned to an employee.' });
  if (activeAssignmentsFor(id).some(a => a.upsAssetId === ups.id)) return res.status(409).json({ error: 'A UPS Battery is already assigned to this UPS.' });
  if (Number(battery.quantity) - activeAssignmentsFor(id).length <= 0) return res.status(409).json({ error: 'This UPS Battery item is out of stock.' });

  const assignment = {
    id: nextId(), assetId: battery.id, employeeId: upsAssignment.employeeId, upsAssetId: ups.id,
    assignedBy: req.user.id, assignedDate: new Date().toISOString().slice(0, 10), returnedDate: null, status: 'Active',
  };
  db.data.assetAssignments.push(assignment);
  recomputeStockStatus(battery);
  logAction(battery.id, 'Assigned', req.user.id, `UPS Battery assigned to UPS ${ups.serialNumber || ups.assetTag} (${userName(upsAssignment.employeeId)}).`);
  notifyAssigned(battery, upsAssignment.employeeId);

  await db.write();
  res.json(enrichAsset(battery));
});

assetsRouter.post('/:id/bulk-assign', requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const { employeeIds } = req.body || {};
  if (!Array.isArray(employeeIds) || employeeIds.length === 0) return res.status(400).json({ error: 'employeeIds must be a non-empty array.' });

  const asset = db.data.assets.find(a => a.id === id);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });
  if (isUpsBattery(asset)) return res.status(400).json({ error: 'UPS Batteries must be assigned to a UPS, not directly to employees.' });
  if (isQuantityAsset(asset)) {
    return res.status(400).json({ error: 'Bulk assignment is only for standard assets. Use single assignment for quantity-tracked items.' });
  }

  const already = new Set(activeAssignmentsFor(id).map(a => a.employeeId));
  const created = [];
  for (const rawId of employeeIds) {
    const employeeId = Number(rawId);
    if (already.has(employeeId)) continue;
    const employee = db.data.users.find(u => u.id === employeeId);
    if (!employee) continue;
    const assignment = { id: nextId(), assetId: id, employeeId, assignedBy: req.user.id, assignedDate: new Date().toISOString().slice(0, 10), returnedDate: null, status: 'Active' };
    db.data.assetAssignments.push(assignment);
    notifyAssigned(asset, employeeId);
    created.push(employee.name);
  }

  if (created.length === 0) return res.status(409).json({ error: 'All selected employees are already assigned to this asset.' });

  asset.status = 'In Use';
  logAction(id, 'Assigned', req.user.id, `Bulk-assigned to ${created.join(', ')} by ${req.user.name}.`);
  await db.write();
  res.json(enrichAsset(asset));
});

assetsRouter.post('/:id/return', requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const asset = db.data.assets.find(a => a.id === id);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });

  const active = activeAssignmentsFor(id);
  if (active.length === 0) return res.status(409).json({ error: 'This asset does not have an active assignment.' });

  const { employeeId, assignmentId, upsAssetId } = req.body || {};
  let assignment;
  if (assignmentId !== undefined) {
    assignment = active.find(a => a.id === Number(assignmentId));
  } else if (upsAssetId !== undefined && isUpsBattery(asset)) {
    assignment = active.find(a => a.upsAssetId === Number(upsAssetId));
  } else if (employeeId !== undefined) {
    assignment = active.find(a => a.employeeId === Number(employeeId));
  } else if (active.length === 1) {
    assignment = active[0];
  } else {
    return res.status(400).json({ error: 'Multiple assignments exist; specify which assignment to return.' });
  }

  if (!assignment) return res.status(404).json({ error: 'No matching active assignment found.' });

  const resolved = assignmentEmployee(asset, assignment);
  const employeeName = resolved?.employeeName || userName(assignment.employeeId);
  assignment.returnedDate = new Date().toISOString().slice(0, 10);
  assignment.status = 'Returned';

  if (isQuantityAsset(asset)) recomputeStockStatus(asset);
  else if (activeAssignmentsFor(id).length === 0) asset.status = 'Available';

  logAction(id, 'Returned', req.user.id, `${asset.name} (${asset.assetTag}) was returned by ${employeeName}.`);
  await db.write();
  res.json(enrichAsset(asset));
});

assetsRouter.post('/:id/retire', requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const asset = db.data.assets.find(a => a.id === id);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });
  if (activeAssignmentsFor(id).length > 0) return res.status(409).json({ error: 'Return this asset before retiring it.' });

  asset.status = 'Retired';
  logAction(id, 'Status Changed', req.user.id, `${asset.name} (${asset.assetTag}) was retired from active service by ${req.user.name}.`);
  await db.write();
  res.json(enrichAsset(asset));
});

assetsRouter.get('/:id/history', requireRole('Admin', 'Manager'), (req, res) => {
  const id = Number(req.params.id);

  if (req.user.role === 'Manager') {
    const teamIds = teamIdsOf(req.user.id);
    const everAssignedToTeam = db.data.assetAssignments.some(a => {
      if (a.assetId !== id) return false;
      const employeeId = isUpsBattery(db.data.assets.find(asset => asset.id === id)) && a.upsAssetId
        ? activeUpsAssignment(a.upsAssetId)?.employeeId
        : a.employeeId;
      return teamIds.has(employeeId);
    });
    if (!everAssignedToTeam) return res.status(403).json({ error: 'You can only view history for assets assigned to your team.' });
  }

  const asset = db.data.assets.find(a => a.id === id);
  const assignments = db.data.assetAssignments.filter(a => a.assetId === id)
    .map(a => ({
      ...a,
      employeeName: assignmentEmployee(asset, a)?.employeeName || userName(a.employeeId),
      assignedByName: userName(a.assignedBy),
      upsAssetTag: a.upsAssetId ? db.data.assets.find(u => u.id === a.upsAssetId)?.assetTag || null : null,
      upsSerialNumber: a.upsAssetId ? db.data.assets.find(u => u.id === a.upsAssetId)?.serialNumber || null : null,
    }))
    .sort((a, b) => (a.assignedDate < b.assignedDate ? 1 : -1));
  const logs = db.data.assetLogs.filter(l => l.assetId === id)
    .map(l => ({ ...l, performedByName: userName(l.performedBy) }))
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  res.json({ assignments, logs });
});
