import { Router } from 'express';
import { db, nextId, nextAssetTag } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

export const assetsRouter = Router();
assetsRouter.use(requireAuth(db));

const COMPONENT_PARENT_TYPES = {
  'UPS Battery': 'UPS',
  SSD: 'Desktop',
  RAM: 'Desktop',
};

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

function isComponentAsset(asset) {
  return !!COMPONENT_PARENT_TYPES[asset?.type];
}

function componentParentType(assetType) {
  return COMPONENT_PARENT_TYPES[assetType] || null;
}

function activeParentAssignment(parentAssetId) {
  return activeAssignmentsFor(parentAssetId)[0] || null;
}

function activeComponentAssignmentToParent(parentAssetId, componentType) {
  return db.data.assetAssignments.find(a =>
    a.status === 'Active' &&
    a.parentAssetId === parentAssetId &&
    db.data.assets.find(x => x.id === a.assetId)?.type === componentType
  ) || null;
}

function assignmentEmployee(asset, assignment) {
  if (!assignment) return null;

  if (isComponentAsset(asset) && assignment.parentAssetId) {
    const parentAssignment = activeParentAssignment(assignment.parentAssetId);
    if (!parentAssignment) return null;

    return {
      employeeId: parentAssignment.employeeId,
      employeeName: userName(parentAssignment.employeeId),
      assignedDate: assignment.assignedDate,
      parentAssetId: assignment.parentAssetId,
    };
  }

  if (assignment.employeeId === null || assignment.employeeId === undefined) return null;

  return {
    employeeId: assignment.employeeId,
    employeeName: userName(assignment.employeeId),
    assignedDate: assignment.assignedDate,
  };
}

function enrichAsset(asset) {
  const active = activeAssignmentsFor(asset.id);
  const assignees = active.map(a => assignmentEmployee(asset, a)).filter(Boolean);
  const hasQuantity = asset.quantity !== null && asset.quantity !== undefined;

  return {
    ...asset,
    currentAssignment: assignees[0] || null,
    assignees,
    assignedCount: assignees.length,
    quantityAvailable: hasQuantity ? Math.max(0, Number(asset.quantity) - active.length) : null,
  };
}

function logAction(assetId, action, performedBy, message) {
  db.data.assetLogs.push({
    id: nextId(),
    assetId,
    action,
    performedBy,
    message,
    timestamp: new Date().toLocaleString('en-US'),
  });
}

function recomputeStockStatus(asset) {
  if (asset.quantity === null || asset.quantity === undefined) return;

  const activeCount = activeAssignmentsFor(asset.id).length;
  const available = Math.max(0, Number(asset.quantity) - activeCount);
  const wasOutOfStock = asset.status === 'Out of Stock';

  if (available <= 0 && asset.status !== 'Retired') {
    asset.status = 'Out of Stock';

    if (!wasOutOfStock) {
      db.data.notifications.push({
        id: nextId(),
        audience: 'role',
        role: 'Admin',
        message: `${asset.name} (${asset.assetTag}) is now out of stock.`,
        type: 'warning',
        read: false,
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
    id: nextId(),
    audience: 'user',
    userId: employeeId,
    message: `${asset.name} (${asset.assetTag}) has been assigned to you.`,
    type: 'success',
    read: false,
    timestamp: new Date().toLocaleString('en-US'),
  });
}

export function assignAssetToEmployee(assetId, employeeId, assignedBy) {
  const asset = db.data.assets.find(a => a.id === assetId);
  if (!asset) throw Object.assign(new Error('Asset not found.'), { status: 404 });

  if (isComponentAsset(asset)) {
    throw Object.assign(
      new Error(`${asset.type} must be assigned to its parent asset, not directly to an employee.`),
      { status: 400 }
    );
  }

  const employee = db.data.users.find(u => u.id === employeeId);
  if (!employee) throw Object.assign(new Error('Employee not found.'), { status: 404 });

  const hasQuantity = asset.quantity !== null && asset.quantity !== undefined;
  const active = activeAssignmentsFor(assetId);

  if (hasQuantity) {
    if (Number(asset.quantity) - active.length <= 0) {
      throw Object.assign(new Error('This item is out of stock.'), { status: 409 });
    }

    if (active.some(a => a.employeeId === employeeId)) {
      throw Object.assign(new Error('Already assigned to this employee.'), { status: 409 });
    }
  } else if (active.length > 0) {
    throw Object.assign(new Error('Asset is not currently available for assignment.'), { status: 409 });
  }

  const assignment = {
    id: nextId(),
    assetId,
    employeeId,
    assignedBy,
    assignedDate: new Date().toISOString().slice(0, 10),
    returnedDate: null,
    status: 'Active',
  };

  db.data.assetAssignments.push(assignment);

  if (hasQuantity) recomputeStockStatus(asset);
  else asset.status = 'In Use';

  logAction(assetId, 'Assigned', assignedBy, `Assigned to ${employee.name} by ${userName(assignedBy)}.`);
  notifyAssigned(asset, employeeId);

  return { asset, assignment };
}

assetsRouter.get('/', (req, res) => {
  if (req.user.role === 'Employee') {
    const mineIds = new Set(
      db.data.assetAssignments
        .filter(a => {
          if (a.status !== 'Active') return false;
          if (a.employeeId === req.user.id) return true;
          if (a.parentAssetId) return activeParentAssignment(a.parentAssetId)?.employeeId === req.user.id;
          return false;
        })
        .map(a => a.assetId)
    );

    return res.json(db.data.assets.filter(a => mineIds.has(a.id)).map(enrichAsset));
  }

  if (req.user.role === 'Manager') {
    const teamIds = teamIdsOf(req.user.id);
    const teamAssetIds = new Set(
      db.data.assetAssignments
        .filter(a => {
          if (a.status !== 'Active') return false;
          const employeeId = a.parentAssetId
            ? activeParentAssignment(a.parentAssetId)?.employeeId
            : a.employeeId;
          return teamIds.has(employeeId);
        })
        .map(a => a.assetId)
    );

    return res.json(db.data.assets.filter(a => teamAssetIds.has(a.id)).map(enrichAsset));
  }

  res.json(db.data.assets.map(enrichAsset));
});

assetsRouter.post('/', requireRole('Admin'), async (req, res) => {
  const { name, type, brand, model, serialNumber, purchaseDate, cost, warrantyExpiry, remarks, specs, imageUrl, quantity } = req.body || {};
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
    id: nextId(),
    name,
    type,
    assetTag: nextAssetTag(type),
    brand: brand || '',
    model: model || '',
    serialNumber: serialNumber || '',
    purchaseDate: purchaseDate || '',
    cost: numericCost,
    warrantyExpiry: warrantyExpiry || '',
    status: 'Available',
    remarks: remarks || '',
    specs: (specs && typeof specs === 'object') ? specs : {},
    imageUrl: imageUrl || null,
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
    status: source.quantity !== null && source.quantity !== undefined && Number(source.quantity) === 0 ? 'Out of Stock' : 'Available',
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

  const { name, type, brand, model, serialNumber, purchaseDate, cost, warrantyExpiry, remarks, specs, imageUrl, quantity } = req.body || {};

  if (name !== undefined) asset.name = name;
  if (type !== undefined) asset.type = type;
  if (brand !== undefined) asset.brand = brand;
  if (model !== undefined) asset.model = model;
  if (serialNumber !== undefined) asset.serialNumber = serialNumber;
  if (purchaseDate !== undefined) asset.purchaseDate = purchaseDate;

  if (cost !== undefined) {
    const numericCost = cost === null || cost === '' ? null : Number(cost);
    if (numericCost !== null && (!Number.isFinite(numericCost) || numericCost < 0)) {
      return res.status(400).json({ error: 'Cost must be a valid number 0 or greater.' });
    }
    asset.cost = numericCost;
  }

  if (warrantyExpiry !== undefined) asset.warrantyExpiry = warrantyExpiry;
  if (remarks !== undefined) asset.remarks = remarks;
  if (specs !== undefined && typeof specs === 'object') asset.specs = specs;
  if (imageUrl !== undefined) asset.imageUrl = imageUrl;

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

assetsRouter.get('/component-options/:type', requireRole('Admin'), (req, res) => {
  const componentType = req.params.type;
  const parentType = componentParentType(componentType);

  if (!parentType) {
    return res.status(400).json({ error: 'Unsupported component asset type.' });
  }

  const options = db.data.assets
    .filter(parent => parent.type === parentType)
    .map(parent => {
      const parentAssignment = activeParentAssignment(parent.id);
      const existingComponentAssignment = activeComponentAssignmentToParent(parent.id, componentType);

      return {
        id: parent.id,
        name: parent.name,
        brand: parent.brand || '',
        serialNumber: parent.serialNumber || '',
        assetTag: parent.assetTag,
        assignedEmployeeId: parentAssignment?.employeeId || null,
        assignedEmployeeName: parentAssignment ? userName(parentAssignment.employeeId) : null,
        display: `${parent.serialNumber || parent.assetTag} - ${parentAssignment ? userName(parentAssignment.employeeId) : 'Unassigned'}`,
        available: !!parentAssignment && !existingComponentAssignment,
      };
    })
    .filter(option => option.available);

  res.json(options);
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

assetsRouter.post('/:id/assign-component', requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const { parentAssetId } = req.body || {};

  const asset = db.data.assets.find(a => a.id === id);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });

  const expectedParentType = componentParentType(asset.type);
  if (!expectedParentType) {
    return res.status(400).json({ error: 'This asset is not a supported component.' });
  }

  if (!parentAssetId) {
    return res.status(400).json({ error: 'parentAssetId is required.' });
  }

  const parent = db.data.assets.find(a => a.id === Number(parentAssetId));
  if (!parent || parent.type !== expectedParentType) {
    return res.status(400).json({ error: `A ${asset.type} must be assigned to a ${expectedParentType}.` });
  }

  const parentAssignment = activeParentAssignment(parent.id);
  if (!parentAssignment) {
    return res.status(409).json({ error: `The selected ${expectedParentType} is not currently assigned to an employee.` });
  }

  const activeComponentAssignments = activeAssignmentsFor(asset.id);
  if (asset.quantity === null || asset.quantity === undefined) {
    return res.status(400).json({ error: `${asset.type} must have a quantity configured before assignment.` });
  }

  if (Number(asset.quantity) - activeComponentAssignments.length <= 0) {
    return res.status(409).json({ error: 'This component is out of stock.' });
  }

  if (activeComponentAssignmentToParent(parent.id, asset.type)) {
    return res.status(409).json({ error: `This ${expectedParentType} already has a ${asset.type} assigned.` });
  }

  const assignment = {
    id: nextId(),
    assetId: asset.id,
    employeeId: parentAssignment.employeeId,
    parentAssetId: parent.id,
    assignedBy: req.user.id,
    assignedDate: new Date().toISOString().slice(0, 10),
    returnedDate: null,
    status: 'Active',
  };

  db.data.assetAssignments.push(assignment);
  recomputeStockStatus(asset);

  logAction(
    asset.id,
    'Assigned',
    req.user.id,
    `${asset.name} (${asset.assetTag}) was assigned to ${parent.serialNumber || parent.assetTag} (${userName(parentAssignment.employeeId)}) by ${req.user.name}.`
  );

  notifyAssigned(asset, parentAssignment.employeeId);

  await db.write();
  res.json(enrichAsset(asset));
});

assetsRouter.post('/:id/bulk-assign', requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const { employeeIds } = req.body || {};
  if (!Array.isArray(employeeIds) || employeeIds.length === 0) return res.status(400).json({ error: 'employeeIds must be a non-empty array.' });

  const asset = db.data.assets.find(a => a.id === id);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });
  if (isComponentAsset(asset)) return res.status(400).json({ error: `${asset.type} must be assigned to its parent asset.` });
  if (asset.quantity !== null && asset.quantity !== undefined) {
    return res.status(400).json({ error: 'Bulk assignment is only for standard assets. Use single assignment for quantity-tracked items.' });
  }

  const already = new Set(activeAssignmentsFor(id).map(a => a.employeeId));
  const created = [];

  for (const rawId of employeeIds) {
    const employeeId = Number(rawId);
    if (already.has(employeeId)) continue;

    const employee = db.data.users.find(u => u.id === employeeId);
    if (!employee) continue;

    const assignment = {
      id: nextId(),
      assetId: id,
      employeeId,
      assignedBy: req.user.id,
      assignedDate: new Date().toISOString().slice(0, 10),
      returnedDate: null,
      status: 'Active',
    };

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

  const { employeeId, parentAssetId } = req.body || {};
  let assignment;

  if (parentAssetId !== undefined) {
    assignment = active.find(a => Number(a.parentAssetId) === Number(parentAssetId));
    if (!assignment) return res.status(404).json({ error: 'No active component assignment found for that parent asset.' });
  } else if (employeeId !== undefined) {
    assignment = active.find(a => a.employeeId === Number(employeeId));
    if (!assignment) return res.status(404).json({ error: 'No active assignment found for that employee.' });
  } else if (active.length === 1) {
    assignment = active[0];
  } else {
    return res.status(400).json({ error: 'Multiple assignments exist; specify the employee or parent asset to return.' });
  }

  const parent = assignment.parentAssetId
    ? db.data.assets.find(a => a.id === Number(assignment.parentAssetId))
    : null;

  const employeeIdForLog = parent ? activeParentAssignment(parent.id)?.employeeId || assignment.employeeId : assignment.employeeId;
  const employeeName = userName(employeeIdForLog);

  assignment.returnedDate = new Date().toISOString().slice(0, 10);
  assignment.status = 'Returned';

  const hasQuantity = asset.quantity !== null && asset.quantity !== undefined;
  if (hasQuantity) recomputeStockStatus(asset);
  else if (activeAssignmentsFor(id).length === 0) asset.status = 'Available';

  const locationLabel = parent ? ` from ${parent.serialNumber || parent.assetTag}` : ` by ${employeeName}`;
  logAction(id, 'Returned', req.user.id, `${asset.name} (${asset.assetTag}) was returned${locationLabel}.`);

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
      const employeeId = a.parentAssetId
        ? activeParentAssignment(a.parentAssetId)?.employeeId || a.employeeId
        : a.employeeId;
      return teamIds.has(employeeId);
    });

    if (!everAssignedToTeam) {
      return res.status(403).json({ error: 'You can only view history for assets assigned to your team.' });
    }
  }

  const assignments = db.data.assetAssignments
    .filter(a => a.assetId === id)
    .map(a => {
      const parent = a.parentAssetId ? db.data.assets.find(x => x.id === Number(a.parentAssetId)) : null;
      const parentAssignment = parent ? activeParentAssignment(parent.id) : null;
      const employeeId = parentAssignment?.employeeId || a.employeeId;

      return {
        ...a,
        employeeName: userName(employeeId),
        assignedByName: userName(a.assignedBy),
        parentAssetId: parent?.id || a.parentAssetId || null,
        parentAssetTag: parent?.assetTag || null,
        parentSerialNumber: parent?.serialNumber || null,
      };
    })
    .sort((a, b) => (a.assignedDate < b.assignedDate ? 1 : -1));

  const logs = db.data.assetLogs
    .filter(l => l.assetId === id)
    .map(l => ({ ...l, performedByName: userName(l.performedBy) }))
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  res.json({ assignments, logs });
});
