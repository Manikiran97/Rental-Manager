import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import { useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { Archive, Download, Pencil, Printer, Trash2, Upload, UserPlus, Users } from 'lucide-react-native';
import { useCallback, useContext, useState } from 'react';
import { Alert, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import CustomDatePicker from '../src/components/CustomDatePicker';
import { PropertyContext } from '../src/context/PropertyContext';
import { defaultDB } from '../src/db';

const AddTenantForm = ({ activeProperty, rooms, loadData }) => {
  const [form, setForm] = useState({ room_id: '', name: '', phone: '', aadhar: '', rent_amount: '', due_date: new Date().toISOString().split('T')[0] });
  const [showPicker, setShowPicker] = useState(false);

  const handleAdd = async () => {
    if (!form.room_id || !form.name || !form.phone || !form.rent_amount) {
      Alert.alert('Error', 'Please fill required fields.');
      return;
    }

    // Check if room occupied
    const t = await defaultDB.getTenants();
    if (t.some(x => x.room_id === Number(form.room_id) && x.is_active)) {
      Alert.alert('Error', 'Room is currently occupied!');
      return;
    }

    const tenantId = await defaultDB.addTenant({
      room_id: Number(form.room_id),
      name: form.name,
      phone: form.phone,
      aadhar: form.aadhar,
      joining_date: form.due_date
    });

    const room = rooms.find(r => r.id === Number(form.room_id));
    if (room) {
      room.status = 'Occupied';
      await defaultDB.updateRoom(room);
    }

    // Add first month rent due
    await defaultDB.addDue({
      tenant_id: tenantId,
      amount_due: Number(form.rent_amount),
      due_date: form.due_date,
      status: 'Pending',
      due_type: 'Rent'
    });

    setForm({ room_id: '', name: '', phone: '', aadhar: '', rent_amount: '', due_date: new Date().toISOString().split('T')[0] });
    loadData();
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Add New Tenant</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Select Room</Text>
        {/* Simple mock Picker - in real RN we'd use @react-native-picker/picker, but we can do a simple layout here */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', gap: 8 }}>
          {rooms.map(r => (
            <TouchableOpacity
              key={r.id}
              style={[styles.pillBtn, form.room_id === r.id && styles.pillBtnActive]}
              onPress={() => {
                setForm({ ...form, room_id: r.id, rent_amount: String(r.rent_amount) });
              }}
            >
              <Text style={form.room_id === r.id ? styles.pillTextActive : styles.pillText}>Apt {r.room_number}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Tenant Name</Text>
        <TextInput style={styles.input} value={form.name} onChangeText={t => setForm({ ...form, name: t })} />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Phone Number</Text>
        <TextInput style={styles.input} keyboardType="phone-pad" value={form.phone} onChangeText={t => setForm({ ...form, phone: t })} />
      </View>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={[styles.inputGroup, { flex: 1 }]}>
          <Text style={styles.label}>1st Month Rent</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={form.rent_amount} onChangeText={t => setForm({ ...form, rent_amount: t })} />
        </View>
        <View style={[styles.inputGroup, { flex: 1 }]}>
          <Text style={styles.label}>Joining Date</Text>
          <TouchableOpacity style={styles.input} onPress={() => setShowPicker(true)}>
            <Text style={{ fontSize: 16, color: '#1e293b' }}>{new Date(form.due_date).toLocaleDateString('en-GB')}</Text>
          </TouchableOpacity>
          <CustomDatePicker
            visible={showPicker}
            value={new Date(form.due_date)}
            onChange={(d) => setForm({ ...form, due_date: d.toISOString().split('T')[0] })}
            onClose={() => setShowPicker(false)}
          />
        </View>
      </View>

      <TouchableOpacity style={styles.btnPrimary} onPress={handleAdd}>
        <UserPlus size={18} color="#fff" style={{ marginRight: 8 }} />
        <Text style={styles.btnPrimaryText}>Save Tenant</Text>
      </TouchableOpacity>
    </View>
  );
};

export default function TenantsScreen() {
  const { activeProperty } = useContext(PropertyContext);
  const [tenants, setTenants] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [filterMode, setFilterMode] = useState('active');
  const [editingTenant, setEditingTenant] = useState(null);

  const formatDisplayDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('default', { month: 'short' });
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  };

  const loadData = async () => {
    if (!activeProperty) return;
    const r = await defaultDB.getRoomsByProperty(activeProperty.id);
    const rIds = r.map(x => x.id);
    const t = await defaultDB.getTenants();
    setRooms(r);
    setTenants(t.filter(x => rIds.includes(x.room_id)));
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [activeProperty])
  );

  const handleImportCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/csv', '*/*'],
        copyToCacheDirectory: true
      });

      if (result.canceled || !result.assets || !result.assets.length) return;

      const fileUri = result.assets[0].uri;
      let text = '';

      if (Platform.OS === 'web' && result.assets[0].file) {
        text = await result.assets[0].file.text();
      } else {
        const response = await fetch(fileUri);
        text = await response.text();
      }

      if (!text || text.trim() === '') {
        Alert.alert("Error", "The selected file is empty.");
        return;
      }

      const rows = text.split('\n');
      let importedCount = 0;

      const parseDate = (dateStr) => {
        if (!dateStr) return null;
        const cleanStr = dateStr.trim();
        const parts = cleanStr.split(/[-/]/);

        if (parts.length === 3) {
          let day, month, year;
          if (parts[0].length === 4) { // YYYY-MM-DD
            year = parseInt(parts[0]);
            month = parseInt(parts[1]) - 1;
            day = parseInt(parts[2]);
          } else { // DD-MM-YYYY or DD-MM-YY
            day = parseInt(parts[0]);
            month = parseInt(parts[1]) - 1;
            year = parseInt(parts[2]);
            if (year < 100) year += 2000;
          }
          const d = new Date(year, month, day);
          if (!isNaN(d.getTime())) {
            const Y = d.getFullYear();
            const M = String(d.getMonth() + 1).padStart(2, '0');
            const D = String(d.getDate()).padStart(2, '0');
            return `${Y}-${M}-${D}`;
          }
        }

        const nativeD = new Date(cleanStr);
        if (!isNaN(nativeD.getTime())) {
          const Y = nativeD.getFullYear();
          const M = String(nativeD.getMonth() + 1).padStart(2, '0');
          const D = String(nativeD.getDate()).padStart(2, '0');
          return `${Y}-${M}-${D}`;
        }
        return null;
      };

      for (let i = 1; i < rows.length; i++) {
        if (!rows[i].trim()) continue;
        const cols = rows[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());

        if (cols.length >= 2) {
          let name, phone, roomStr, aadharOrEmail;
          let joiningDate = null;

          if (cols[0].toLowerCase() === 'status' || cols[1].toLowerCase() === 'name') continue;

          if (cols[0].toLowerCase() === 'active' || cols[0].toLowerCase() === 'past' || cols.length >= 6) {
            if (cols[0].toLowerCase() === 'past') continue;
            name = cols[1];
            phone = cols[2];
            aadharOrEmail = cols[3];
            roomStr = cols[4];

            // Grab Move In date (index 7 in exported CSV)
            if (cols.length >= 8) {
              joiningDate = parseDate(cols[7]);
            }
          } else {
            name = cols[0];
            phone = cols[1];
            roomStr = cols[2] || '';
            aadharOrEmail = cols[3] || '';

            // Simple format: if 5 columns, last one is date
            if (cols.length >= 5) {
              joiningDate = parseDate(cols[4]);
            }
          }

          if (name) {
            let assignedRoomId = null;
            if (roomStr && roomStr.toLowerCase() !== 'unmapped') {
              const rawRoomNum = roomStr.includes('-') ? roomStr.split('-').pop().trim() : roomStr;
              const matchedRoom = rooms.find(r => r.room_number.toLowerCase() === rawRoomNum.toLowerCase());

              if (matchedRoom) {
                const isOccupied = tenants.some(t => t.room_id === matchedRoom.id && t.is_active);
                if (!isOccupied) {
                  assignedRoomId = matchedRoom.id;
                  matchedRoom.status = 'Occupied';
                  await defaultDB.updateRoom(matchedRoom);
                }
              }
            }

            await defaultDB.addTenant({
              room_id: assignedRoomId,
              name: name,
              phone: phone || '',
              aadhar: aadharOrEmail || '',
              joining_date: joiningDate
            });
            importedCount++;
          }
        }
      }

      if (importedCount === 0) {
        Alert.alert("Warning", "No active tenants were imported. Check CSV format.");
      } else {
        Alert.alert("Success", `Imported ${importedCount} tenants! Active room assignments locked.`);
        loadData();
      }
    } catch (err) {
      console.error('Import CSV Error:', err);
      Alert.alert("Error", `Failed to import CSV.\n\nDetails: ${err.message || String(err)}`);
    }
  };

  const handleExportCSV = async () => {
    let csvContent = "Status,Name,Phone,Aadhar,Room,Tenant Type,Number of People,Move In Date\n";
    tenants.forEach(tenant => {
      const room = rooms.find(r => r.id === tenant.room_id);
      const moveInStamp = tenant.joining_date || new Date(tenant.created_at).toISOString().split('T')[0];
      csvContent += `"${tenant.is_active ? 'Active' : 'Past'}","${tenant.name}","${tenant.phone || ''}","${tenant.aadhar || ''}","${activeProperty.name} - ${room?.room_number || 'Unmapped'}","Family","1","${moveInStamp}"\n`;
    });

    try {
      if (Platform.OS === 'web') {
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Tenants_Export_${activeProperty.name}.csv`;
        a.click();
        return;
      }
      const fileUri = FileSystem.documentDirectory + `Tenants_Export_${activeProperty.name.replace(/\s+/g, '_')}.csv`;
      await FileSystem.writeAsStringAsync(fileUri, csvContent, { encoding: 'utf8' });
      await Sharing.shareAsync(fileUri);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to export CSV.');
    }
  };

  const handleExportPDF = async () => {
    let htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: sans-serif; padding: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; color: #1e293b; }
            h1 { color: #0f172a; }
          </style>
        </head>
        <body>
          <h1>${activeProperty.name} - Tenants Inventory</h1>
          <table>
            <tr>
              <th>Status</th><th>Name</th><th>Phone</th><th>Room</th>
            </tr>
    `;
    tenants.forEach(tenant => {
      const room = rooms.find(r => r.id === tenant.room_id);
      htmlContent += `
        <tr>
          <td>${tenant.is_active ? 'Active' : 'Past'}</td>
          <td>${tenant.name}</td>
          <td>${tenant.phone || ''}</td>
          <td>${room?.room_number || 'Unmapped'}</td>
        </tr>
      `;
    });
    htmlContent += `</table></body></html>`;

    try {
      const { uri } = await Print.printToFileAsync({ html: htmlContent });
      if (Platform.OS === 'web') {
        await Print.printAsync({ html: htmlContent });
      } else {
        await Sharing.shareAsync(uri);
      }
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to export PDF.');
    }
  };

  const handleVacate = (tenant) => {
    Alert.alert('Vacate Tenant', `Are you sure you want to mark ${tenant.name} as moved out?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Vacate', style: 'destructive', onPress: async () => {
          await defaultDB.updateTenant({ ...tenant, is_active: false });
          const room = rooms.find(r => r.id === tenant.room_id);
          if (room) {
            room.status = 'Available';
            await defaultDB.updateRoom(room);
          }
          loadData();
        }
      }
    ])
  };

  const handleUpdate = async (updatedTenant) => {
    try {
      const oldTenant = tenants.find(t => t.id === updatedTenant.id);

      // Handle room change logic
      if (oldTenant && oldTenant.room_id !== updatedTenant.room_id) {
        // Mark old room as Available
        if (oldTenant.room_id) {
          const oldRoom = rooms.find(r => r.id === oldTenant.room_id);
          if (oldRoom) {
            await defaultDB.updateRoom({ ...oldRoom, status: 'Available' });
          }
        }
        // Mark new room as Occupied
        if (updatedTenant.room_id) {
          const newRoom = rooms.find(r => r.id === updatedTenant.room_id);
          if (newRoom) {
            await defaultDB.updateRoom({ ...newRoom, status: 'Occupied' });
          }
        }
      }

      await defaultDB.updateTenant(updatedTenant);
      setEditingTenant(null);
      loadData();
      Alert.alert('Success', 'Tenant updated successfully!');
    } catch (error) {
      console.error('Update Error:', error);
      Alert.alert('Error', 'Failed to update tenant details.');
    }
  };

  const EditTenantModal = () => {
    if (!editingTenant) return null;
    const [efm, setEfm] = useState({ ...editingTenant });
    const [showEditPicker, setShowEditPicker] = useState(false);

    return (
      <Modal visible={!!editingTenant} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={styles.cardTitle}>Edit Tenant</Text>
              <TouchableOpacity onPress={() => setEditingTenant(null)}>
                <Text style={{ color: '#ef4444' }}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <ScrollView>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Tenant Name</Text>
                <TextInput
                  style={styles.input}
                  value={efm.name}
                  onChangeText={t => setEfm({ ...efm, name: t })}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Phone Number</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="phone-pad"
                  value={efm.phone}
                  onChangeText={t => setEfm({ ...efm, phone: t })}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Aadhar / Email</Text>
                <TextInput
                  style={styles.input}
                  value={efm.aadhar}
                  onChangeText={t => setEfm({ ...efm, aadhar: t })}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Room Assignment</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', gap: 8 }}>
                  {rooms.map(r => {
                    const isOccupied = tenants.some(t => t.room_id === r.id && t.is_active && t.id !== editingTenant.id);
                    return (
                      <TouchableOpacity
                        key={r.id}
                        disabled={isOccupied}
                        style={[
                          styles.pillBtn,
                          efm.room_id === r.id && styles.pillBtnActive,
                          isOccupied && { opacity: 0.4 }
                        ]}
                        onPress={() => setEfm({ ...efm, room_id: r.id })}
                      >
                        <Text style={efm.room_id === r.id ? styles.pillTextActive : styles.pillText}>
                          Apt {r.room_number} {isOccupied ? '(Full)' : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Move-In Date</Text>
                <TouchableOpacity style={styles.input} onPress={() => setShowEditPicker(true)}>
                  <Text style={{ fontSize: 16, color: '#1e293b' }}>
                    {efm.joining_date ? new Date(efm.joining_date).toLocaleDateString('en-GB') : 'Select Date'}
                  </Text>
                </TouchableOpacity>
                <CustomDatePicker
                  visible={showEditPicker}
                  value={efm.joining_date ? new Date(efm.joining_date) : new Date()}
                  onChange={(d) => setEfm({ ...efm, joining_date: d.toISOString().split('T')[0] })}
                  onClose={() => setShowEditPicker(false)}
                />
              </View>

              <TouchableOpacity style={styles.btnPrimary} onPress={() => handleUpdate(efm)}>
                <Text style={styles.btnPrimaryText}>Save Changes</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  const activeTenants = tenants.filter(t => t.is_active);
  const pastTenants = tenants.filter(t => !t.is_active);

  if (!activeProperty) {
    return <View style={styles.centerContainer}><Text>No property active.</Text></View>;
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Users size={28} color="#1e293b" />
        <View style={{ marginLeft: 12 }}>
          <Text style={styles.headerTitle}>Tenants</Text>
          <Text style={styles.headerSubtitle}>{activeProperty.name}</Text>
        </View>
      </View>

      <AddTenantForm activeProperty={activeProperty} rooms={rooms} loadData={loadData} />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', flex: 1, gap: 12, marginRight: 16 }}>
          <TouchableOpacity style={[styles.tabBtn, filterMode === 'active' && styles.tabBtnActive]} onPress={() => setFilterMode('active')}>
            <Text style={[styles.tabBtnText, filterMode === 'active' && { color: '#fff' }]}>Active ({activeTenants.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, filterMode === 'past' && styles.tabBtnActive]} onPress={() => setFilterMode('past')}>
            <Text style={[styles.tabBtnText, filterMode === 'past' && { color: '#fff' }]}>Past ({pastTenants.length})</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <TouchableOpacity style={{ padding: 4 }} onPress={handleExportPDF}>
            <Printer size={18} color="#475569" />
          </TouchableOpacity>
          <TouchableOpacity style={{ padding: 4 }} onPress={handleExportCSV}>
            <Download size={18} color="#475569" />
          </TouchableOpacity>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 4 }} onPress={handleImportCSV}>
            <Upload size={16} color="#3b82f6" />
            <Text style={{ color: '#3b82f6', fontWeight: 'bold', marginLeft: 4 }}>CSV</Text>
          </TouchableOpacity>
        </View>
      </View>

      {(filterMode === 'active' ? activeTenants : pastTenants).map(tenant => {
        const room = rooms.find(r => r.id === tenant.room_id);
        return (
          <View key={tenant.id} style={styles.roomCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.roomTitle}>{tenant.name}</Text>
              <Text style={{ color: '#64748b', marginTop: 4 }}>📱 {tenant.phone}</Text>
              {room && <Text style={{ color: '#64748b', marginTop: 2 }}>🏠 Room {room.room_number}</Text>}
              <Text style={{ color: '#8b5cf6', marginTop: 8, fontWeight: '600' }}>📅 Move-In: {formatDisplayDate(tenant.joining_date || tenant.created_at)}</Text>
            </View>
            <View style={styles.actionCol}>
              <View style={{ gap: 8 }}>
                {filterMode === 'active' && (
                  <>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => setEditingTenant(tenant)}>
                      <Pencil size={18} color="#3b82f6" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => handleVacate(tenant)}>
                      <Archive size={18} color="#f59e0b" />
                    </TouchableOpacity>
                  </>
                )}
                {filterMode === 'past' && (
                  <TouchableOpacity style={styles.iconBtn} onPress={async () => {
                    await defaultDB.deleteTenant(tenant.id);
                    loadData();
                  }}>
                    <Trash2 size={18} color="#ef4444" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        );
      })}

      <EditTenantModal />

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, marginTop: 40 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#0f172a' },
  headerSubtitle: { fontSize: 14, color: '#64748b', marginTop: 2 },

  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 24, elevation: 2 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#0f172a', marginBottom: 16 },

  roomCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', elevation: 1 },
  roomTitle: { fontSize: 18, fontWeight: 'bold', color: '#0f172a' },
  actionCol: { justifyContent: 'space-between', paddingLeft: 12, borderLeftWidth: 1, borderColor: '#f1f5f9' },
  iconBtn: { padding: 8, backgroundColor: '#f8fafc', borderRadius: 8 },

  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#334155', marginBottom: 6 },
  input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },

  pillBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  pillBtnActive: { backgroundColor: '#dbeafe', borderColor: '#3b82f6' },
  pillText: { color: '#475569', fontWeight: '600' },
  pillTextActive: { color: '#1d4ed8', fontWeight: 'bold' },

  btnPrimary: { backgroundColor: '#3b82f6', borderRadius: 8, paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  btnPrimaryText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },

  tabBtn: { flex: 1, paddingVertical: 10, backgroundColor: '#f1f5f9', borderRadius: 8, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#0f172a' },
  tabBtnText: { color: '#475569', fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, maxHeight: '80%' }
});
