import * as SQLite from 'expo-sqlite';

const DB_NAME = 'rentok_mobile.db';

let dbInstance = null;
let initPromise = null;

export const initDB = async () => {
  if (dbInstance) return dbInstance;
  
  if (!initPromise) {
    initPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, location TEXT, created_at INTEGER);
        CREATE TABLE IF NOT EXISTS rooms (id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER, room_number TEXT, type TEXT, rent_amount INTEGER, status TEXT, meter_number TEXT, created_at INTEGER);
        CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER, name TEXT, phone TEXT, aadhar TEXT, is_active INTEGER, created_at INTEGER);
        CREATE TABLE IF NOT EXISTS dues (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, amount_due REAL, due_date TEXT, status TEXT, due_type TEXT, reminder_count INTEGER, created_at INTEGER);
        CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, due_id INTEGER, amount_paid REAL, payment_date TEXT, method TEXT, upi_tx_num TEXT, collected_by TEXT, created_at INTEGER);
        CREATE TABLE IF NOT EXISTS reminder_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, due_id INTEGER, reminder_date TEXT, created_at INTEGER);
      `);
      try {
        // Safe migration for older datasets
        await db.execAsync(`ALTER TABLE tenants ADD COLUMN joining_date TEXT;`);
      } catch (e) {
        // Column already exists
      }
      dbInstance = db;
      return db;
    })();
  }
  return initPromise;
};

// Map equivalent functions to standard idb signature so React components don't need heavy rewrites
export const defaultDB = {
  // Properties
  addProperty: async (property) => {
    const db = await initDB();
    const result = await db.runAsync(
      'INSERT INTO properties (name, location, created_at) VALUES (?, ?, ?)',
      property.name, property.location, Date.now()
    );
    return result.lastInsertRowId;
  },
  getProperties: async () => {
    const db = await initDB();
    return db.getAllAsync('SELECT * FROM properties ORDER BY id ASC');
  },
  deleteProperty: async (id) => {
    const db = await initDB();
    return db.runAsync('DELETE FROM properties WHERE id = ?', id);
  },

  // Rooms
  addRoom: async (room) => {
    const db = await initDB();
    const result = await db.runAsync(
      'INSERT INTO rooms (property_id, room_number, type, rent_amount, status, meter_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      room.property_id, room.room_number, room.type, room.rent_amount, room.status, room.meter_number || '', Date.now()
    );
    return result.lastInsertRowId;
  },
  getRoomsByProperty: async (property_id) => {
    const db = await initDB();
    return db.getAllAsync('SELECT * FROM rooms WHERE property_id = ?', property_id);
  },
  getAllRooms: async () => {
    const db = await initDB();
    return db.getAllAsync('SELECT * FROM rooms');
  },
  updateRoom: async (room) => {
    const db = await initDB();
    return db.runAsync(
      'UPDATE rooms SET room_number = ?, type = ?, rent_amount = ?, status = ?, meter_number = ? WHERE id = ?',
      room.room_number, room.type, room.rent_amount, room.status, room.meter_number || '', room.id
    );
  },
  deleteRoom: async (id) => {
    const db = await initDB();
    return db.runAsync('DELETE FROM rooms WHERE id = ?', id);
  },

  // Tenants
  addTenant: async (tenant) => {
    const db = await initDB();
    const result = await db.runAsync(
      'INSERT INTO tenants (room_id, name, phone, aadhar, is_active, created_at, joining_date) VALUES (?, ?, ?, ?, 1, ?, ?)',
      tenant.room_id, tenant.name, tenant.phone, tenant.aadhar || '', Date.now(), tenant.joining_date || new Date().toISOString().split('T')[0]
    );
    return result.lastInsertRowId;
  },
  getTenants: async () => {
    const db = await initDB();
    const records = await db.getAllAsync('SELECT * FROM tenants');
    // Map SQLite 0/1 back to boolean for front-end
    return records.map(r => ({ ...r, is_active: r.is_active === 1 }));
  },
  getTenantById: async (id) => {
    const db = await initDB();
    const record = await db.getFirstAsync('SELECT * FROM tenants WHERE id = ?', id);
    if(record) record.is_active = record.is_active === 1;
    return record;
  },
  updateTenant: async (tenant) => {
    const db = await initDB();
    return db.runAsync(
      'UPDATE tenants SET room_id = ?, name = ?, phone = ?, aadhar = ?, is_active = ?, joining_date = ? WHERE id = ?',
      tenant.room_id, tenant.name, tenant.phone, tenant.aadhar || '', tenant.is_active ? 1 : 0, tenant.joining_date, tenant.id
    );
  },
  deleteTenant: async (id) => {
    const db = await initDB();
    return db.runAsync('DELETE FROM tenants WHERE id = ?', id);
  },

  // Dues
  addDue: async (due) => {
    const db = await initDB();
    const result = await db.runAsync(
      'INSERT INTO dues (tenant_id, amount_due, due_date, status, due_type, reminder_count, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
      due.tenant_id, due.amount_due, due.due_date, due.status, due.due_type, Date.now()
    );
    return result.lastInsertRowId;
  },
  getPendingDues: async () => {
    const db = await initDB();
    return db.getAllAsync('SELECT * FROM dues WHERE status = ?', 'Pending');
  },
  getDues: async () => {
    const db = await initDB();
    return db.getAllAsync('SELECT * FROM dues');
  },
  getDuesByTenant: async (tenant_id) => {
    const db = await initDB();
    return db.getAllAsync('SELECT * FROM dues WHERE tenant_id = ?', tenant_id);
  },
  updateDueStatus: async (id, status) => {
    const db = await initDB();
    return db.runAsync('UPDATE dues SET status = ? WHERE id = ?', status, id);
  },
  updateDue: async (due) => {
    const db = await initDB();
    return db.runAsync(
      'UPDATE dues SET amount_due = ?, due_date = ?, status = ?, due_type = ? WHERE id = ?',
      due.amount_due, due.due_date, due.status, due.due_type, due.id
    );
  },
  incrementDueReminder: async (dueId) => {
    const db = await initDB();
    await db.runAsync('INSERT INTO reminder_logs (due_id, reminder_date, created_at) VALUES (?, ?, ?)', dueId, new Date().toISOString(), Date.now());
    return db.runAsync('UPDATE dues SET reminder_count = (SELECT COUNT(*) FROM reminder_logs WHERE due_id = ?) WHERE id = ?', dueId, dueId);
  },
  getReminderLogs: async (dueId) => {
    const db = await initDB();
    return db.getAllAsync('SELECT * FROM reminder_logs WHERE due_id = ? ORDER BY created_at DESC', dueId);
  },

  // Sync Recurring Monthly Dues
  syncRecurringDues: async (activePropertyId) => {
    if (!activePropertyId) return;
    const db = await initDB();
    
    // Get all rooms to filter by property
    const allRooms = await db.getAllAsync('SELECT * FROM rooms WHERE property_id = ?', activePropertyId);
    const roomIds = allRooms.map(r => r.id);
    if (roomIds.length === 0) return;
    
    // Get active components
    const allTenants = await db.getAllAsync('SELECT * FROM tenants');
    const activeTenants = allTenants.filter(t => roomIds.includes(t.room_id) && t.is_active === 1);
    
    // Get all 'Rent' and 'Trash' dues
    const allDues = await db.getAllAsync('SELECT * FROM dues WHERE due_type IN ("Rent", "Trash")');
    
    // Fast-generate missing monthly records strictly iterating up to the current real date
    const currentDate = new Date();

    for (const tenant of activeTenants) {
      if (!tenant.joining_date) continue; // Skip un-migrated edge cases
      
      const parts = tenant.joining_date.split('-');
      if (parts.length !== 3) continue;
      
      const startYear = parseInt(parts[0], 10);
      const startMonth = parseInt(parts[1], 10) - 1; // 0-indexed
      const startDay = parseInt(parts[2], 10);
      
      const tenantDues = allDues.filter(d => d.tenant_id === tenant.id);
      const roomSettings = allRooms.find(r => r.id === tenant.room_id);
      const rentAmount = roomSettings ? roomSettings.rent_amount : 0;
      
      // Calculate how many months have passed since Joining Date
      let loopYear = startYear;
      let loopMonth = startMonth;
      
      while (true) {
        // Construct targeted real Due Date
        let targetDueDate = new Date(loopYear, loopMonth, startDay);
        
        if (targetDueDate > currentDate) {
           break;
        }
        
        const formattedDate = `${loopYear}-${String(loopMonth + 1).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
        
        // 1. Check and add Rent
        const rentExists = tenantDues.some(d => d.due_date === formattedDate && d.due_type === 'Rent');
        if (!rentExists) {
           await db.runAsync(
              'INSERT INTO dues (tenant_id, amount_due, due_date, status, due_type, reminder_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
              tenant.id, rentAmount, formattedDate, 'Pending', 'Rent', 0, Date.now()
           );
        }

        // 2. Check and add Trash (100 Rupees)
        const trashExists = tenantDues.some(d => d.due_date === formattedDate && d.due_type === 'Trash');
        if (!trashExists) {
           await db.runAsync(
              'INSERT INTO dues (tenant_id, amount_due, due_date, status, due_type, reminder_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
              tenant.id, 100, formattedDate, 'Pending', 'Trash', 0, Date.now()
           );
        }
        
        // Increment month safely crossing years
        loopMonth++;
        if (loopMonth > 11) {
           loopMonth = 0;
           loopYear++;
        }
      }
    }
  },
  deleteDue: async (id) => {
    const db = await initDB();
    return db.runAsync('DELETE FROM dues WHERE id = ?', id);
  },

  // Payments
  addPayment: async (payment) => {
    const db = await initDB();
    const result = await db.runAsync(
      'INSERT INTO payments (due_id, amount_paid, payment_date, method, upi_tx_num, collected_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      payment.due_id, payment.amount_paid, payment.payment_date, payment.method, payment.upi_tx_num || '', payment.collected_by, Date.now()
    );
    return result.lastInsertRowId;
  },
  getAllPayments: async () => {
    const db = await initDB();
    return db.getAllAsync('SELECT * FROM payments');
  },
  getPaymentsByDue: async (due_id) => {
    const db = await initDB();
    return db.getAllAsync('SELECT * FROM payments WHERE due_id = ?', due_id);
  },
  deletePayment: async (id) => {
    const db = await initDB();
    return db.runAsync('DELETE FROM payments WHERE id = ?', id);
  },
  
  clearFinancialData: async () => {
    const db = await initDB();
    await db.runAsync('DELETE FROM payments');
    await db.runAsync('DELETE FROM dues');
    await db.runAsync('DELETE FROM reminder_logs');
    return true;
  },

  bulkUpdateJoiningDates: async () => {
    const db = await initDB();
    return db.runAsync('UPDATE tenants SET joining_date = "2026-04-01"');
  }
};
