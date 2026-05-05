import React, { useState, useEffect, useContext, useCallback } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, Alert, Modal, Platform } from 'react-native';
import { PropertyContext } from '../src/context/PropertyContext';
import { defaultDB } from '../src/db';
import { Plus, Pencil, Trash2, Home, Upload, Building, ChevronRight, ArrowLeft, Download, Printer } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { useFocusEffect } from 'expo-router';

const AddRoomForm = ({ activeProperty, onRoomAdded }) => {
  const [roomForm, setRoomForm] = useState({ room_number: '', rent_amount: '', meter_number: '' });

  const handleAddRoom = async () => {
    if (!roomForm.room_number || !roomForm.rent_amount) {
      Alert.alert('Error', 'Please fill required fields.');
      return;
    }
    await defaultDB.addRoom({
      property_id: activeProperty.id,
      room_number: roomForm.room_number,
      rent_amount: Number(roomForm.rent_amount),
      meter_number: roomForm.meter_number
    });
    setRoomForm({ room_number: '', rent_amount: '', meter_number: '' });
    onRoomAdded();
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Add New Flat / Room</Text>
      
      <View style={styles.inputGroup}>
        <Text style={styles.label}>Room Number *</Text>
        <TextInput 
          style={styles.input} 
          value={roomForm.room_number} 
          onChangeText={t => setRoomForm({...roomForm, room_number: t})} 
          placeholder="e.g. A-101" 
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Meter Number</Text>
        <TextInput 
          style={styles.input} 
          value={roomForm.meter_number} 
          onChangeText={t => setRoomForm({...roomForm, meter_number: t})} 
          placeholder="e.g. 03670416" 
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Rent Amount (₹) *</Text>
        <TextInput 
          style={styles.input} 
          value={roomForm.rent_amount} 
          keyboardType="numeric"
          onChangeText={t => setRoomForm({...roomForm, rent_amount: t})} 
          placeholder="e.g. 5000" 
        />
      </View>

      <TouchableOpacity style={styles.btnPrimary} onPress={handleAddRoom}>
        <Plus size={18} color="#fff" style={{marginRight: 8}}/>
        <Text style={styles.btnPrimaryText}>Add Room</Text>
      </TouchableOpacity>
    </View>
  );
};

export default function PropertiesScreen() {
  const { activeProperty, setActiveProperty, properties, loadProperties } = useContext(PropertyContext);
  const [rooms, setRooms] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [editingRoom, setEditingRoom] = useState(null);
  const [addingProperty, setAddingProperty] = useState(false);
  const [newPropForm, setNewPropForm] = useState({ name: '', location: '' });
  const [deletePropModal, setDeletePropModal] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isAuthModalVisible, setIsAuthModalVisible] = useState(false);
  const [authPassword, setAuthPassword] = useState('');

  const handleAuthSubmit = () => {
    if (authPassword === '12345') {
      setIsAuthModalVisible(false);
      setAuthPassword('');
      setAddingProperty(true);
    } else {
      Alert.alert('Authentication Failed', 'Incorrect password.');
    }
  };



  const handleCreateProperty = async () => {
    if (!newPropForm.name) return;
    const propId = await defaultDB.addProperty({
       name: newPropForm.name,
       location: newPropForm.location
    });
    setNewPropForm({ name: '', location: '' });
    setAddingProperty(false);
    
    // Auto-select the newly created property
    const updatedProps = await defaultDB.getProperties();
    const created = updatedProps.find(p => p.id === propId);
    if(created) setActiveProperty(created);
    
    loadProperties();
  };

  const handleDeleteProperty = async () => {
    if (deleteConfirmText !== deletePropModal.name) {
       Alert.alert("Mismatch", "The typed name does not match exactly.");
       return;
    }
    await defaultDB.deleteProperty(deletePropModal.id);
    setDeletePropModal(null);
    setDeleteConfirmText('');
    loadProperties();
  };

  const loadData = async () => {
    if (!activeProperty) return;
    
    // Background execution to auto-generate any missing Monthly Rent cycles based on Tenant join dates
    await defaultDB.syncRecurringDues(activeProperty.id);
    
    const r = await defaultDB.getAllRooms();
    const targetRooms = r.filter(room => room.property_id === activeProperty.id);
    const targetRoomIds = targetRooms.map(room => room.id);
    const t = await defaultDB.getTenants();
    const propertyTenants = t.filter(tenant => targetRoomIds.includes(tenant.room_id));
    setRooms(targetRooms);
    setTenants(propertyTenants);
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
      
      for (let i = 1; i < rows.length; i++) {
        if (!rows[i].trim()) continue;
        const cols = rows[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
        
        if (cols.length >= 4) {
             const roomNumber = cols[1];
             // If room number contains "Room No" or "Property" from repeated headers, skip
             if (roomNumber.toLowerCase() === 'room no') continue;
             
             const meterNumber = cols[2] === '-' ? '' : cols[2];
             const rentAmount = parseFloat(cols[3]);

             if (roomNumber && !isNaN(rentAmount)) {
                 await defaultDB.addRoom({
                   property_id: activeProperty.id,
                   room_number: roomNumber,
                   rent_amount: rentAmount,
                   meter_number: meterNumber
                 });
                 importedCount++;
             }
        }
      }
      
      if (importedCount === 0) {
        Alert.alert("Warning", "No flats were imported. Please check the CSV column format.");
      } else {
        Alert.alert("Success", `Successfully processed and imported ${importedCount} flats/rooms into ${activeProperty.name}!`);
        loadData();
      }
    } catch (err) {
      console.error('Import CSV Error:', err);
      Alert.alert("Error", `Failed to import CSV.\n\nDetails: ${err.message || String(err)}`);
    }
  };

  const handleExportCSV = async () => {
    let csvContent = "Property,Room No,Meter No,Rent,Status\n";
    rooms.forEach(room => {
      const isOccupied = tenants.some(t => t.room_id === room.id && t.is_active);
      csvContent += `"${activeProperty.name}","${room.room_number}","${room.meter_number || ''}",${room.rent_amount},${isOccupied ? 'Occupied' : 'Vacant'}\n`;
    });

    try {
      if (Platform.OS === 'web') {
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Flats_Export_${activeProperty.name}.csv`;
        a.click();
        return;
      }
      const fileUri = FileSystem.documentDirectory + `Flats_Export_${activeProperty.name.replace(/\s+/g, '_')}.csv`;
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
          <h1>${activeProperty.name} - Flats Inventory</h1>
          <table>
            <tr>
              <th>Property</th><th>Room No</th><th>Meter No</th><th>Rent</th><th>Status</th>
            </tr>
    `;
    rooms.forEach(room => {
      const isOccupied = tenants.some(t => t.room_id === room.id && t.is_active);
      htmlContent += `
        <tr>
          <td>${activeProperty.name}</td>
          <td>${room.room_number}</td>
          <td>${room.meter_number || ''}</td>
          <td>&#8377; ${room.rent_amount}</td>
          <td>${isOccupied ? 'Occupied' : 'Vacant'}</td>
        </tr>
      `;
    });
    htmlContent += `</table></body></html>`;

    try {
      const { uri } = await Print.printToFileAsync({ html: htmlContent });
      if (Platform.OS === 'web') {
        // web typically opens download dialogue if we simulate an anchor click with base64, but printAsync might be better
        await Print.printAsync({ html: htmlContent });
      } else {
        await Sharing.shareAsync(uri);
      }
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to export PDF.');
    }
  };

  const handleDeleteRoom = (roomId) => {
    const isOccupied = tenants.some(t => t.room_id === roomId && t.is_active);
    if (isOccupied) {
      Alert.alert('Error', 'Cannot delete this room. It has an active mapped tenant.');
      return;
    }
    
    Alert.alert('Delete Room', 'Are you sure you want to delete this room?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await defaultDB.deleteRoom(roomId);
        loadData();
      }}
    ]);
  };

  const handleEditSave = async () => {
    if (!editingRoom.room_number || !editingRoom.rent_amount) return;
    await defaultDB.updateRoom(editingRoom);
    setEditingRoom(null);
    loadData();
  };

  return (
    <View style={{ flex: 1 }}>
      <Modal visible={isAuthModalVisible} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>Admin Authentication</Text>
            <Text style={{ color: '#64748b', marginBottom: 16 }}>Please enter the admin password to create a new property.</Text>
            
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput 
                style={styles.input} 
                value={authPassword} 
                onChangeText={setAuthPassword} 
                placeholder="Enter Password"
                secureTextEntry={true}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <TouchableOpacity style={[styles.btnPrimary, {flex: 1}]} onPress={handleAuthSubmit}>
                <Text style={styles.btnPrimaryText}>Login</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnGhost, {flex: 1}]} onPress={() => {
                  setIsAuthModalVisible(false);
                  setAuthPassword('');
              }}>
                <Text style={{color: '#475569', fontWeight: '600'}}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={addingProperty} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>Create New Property</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Building / Property Name</Text>
              <TextInput 
                style={styles.input} 
                value={newPropForm.name} 
                onChangeText={t => setNewPropForm({...newPropForm, name: t})} 
                placeholder="e.g. Skyline Apartments"
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Location</Text>
              <TextInput 
                style={styles.input} 
                value={newPropForm.location} 
                onChangeText={t => setNewPropForm({...newPropForm, location: t})} 
                placeholder="e.g. Madhapur"
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <TouchableOpacity style={[styles.btnPrimary, {flex: 1}]} onPress={handleCreateProperty}>
                <Text style={styles.btnPrimaryText}>Create</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnGhost, {flex: 1}]} onPress={() => {
                  setAddingProperty(false);
                  setNewPropForm({name:'', location:''});
              }}>
                <Text style={{color: '#475569', fontWeight: '600'}}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {activeProperty ? (
        <ScrollView style={styles.container}>
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <TouchableOpacity onPress={() => setActiveProperty(null)} style={{ marginRight: 12 }}>
                <ArrowLeft size={28} color="#1e293b" />
              </TouchableOpacity>
              <Home size={28} color="#1e293b" />
              <View style={{ marginLeft: 12 }}>
                <Text style={styles.headerTitle}>{activeProperty?.name || 'New'}</Text>
                <Text style={styles.headerSubtitle}>Manage Property Rooms</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.iconBtn} onPress={() => setIsAuthModalVisible(true)}>
               <Text style={{color: '#3b82f6', fontWeight: 'bold'}}>+ New</Text>
            </TouchableOpacity>
          </View>
    
          <AddRoomForm activeProperty={activeProperty} onRoomAdded={loadData} />
    
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 12 }}>
            <Text style={[styles.sectionTitle, { marginTop: 0, marginBottom: 0 }]}>Inventory Layout</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity style={{ padding: 4 }} onPress={handleExportPDF}>
                <Printer size={18} color="#475569" />
              </TouchableOpacity>
              <TouchableOpacity style={{ padding: 4 }} onPress={handleExportCSV}>
                <Download size={18} color="#475569" />
              </TouchableOpacity>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }} onPress={handleImportCSV}>
                <Upload size={16} color="#3b82f6" />
                <Text style={{ color: '#3b82f6', fontWeight: 'bold', marginLeft: 6 }}>Import CSV</Text>
              </TouchableOpacity>
            </View>
          </View>
          {rooms.map(room => {
            const tenant = tenants.find(t => t.room_id === room.id && t.is_active);
            return (
              <View key={room.id} style={styles.roomCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.roomTitle}>Room {room.room_number}</Text>
                  <Text style={{ color: '#64748b', marginTop: 4 }}>Meter: {room.meter_number || 'N/A'}</Text>
                  <Text style={{ color: '#64748b', marginTop: 2 }}>Rent: ₹{room.rent_amount}</Text>
                  {tenant ? (
                    <View style={styles.badgeSuccess}>
                      <Text style={styles.badgeSuccessText}>Occupied: {tenant.name}</Text>
                    </View>
                  ) : (
                    <View style={styles.badgeWarning}>
                      <Text style={styles.badgeWarningText}>Vaccant</Text>
                    </View>
                  )}
                </View>
                <View style={styles.actionCol}>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => setEditingRoom(room)}>
                    <Pencil size={18} color="#475569" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => handleDeleteRoom(room.id)}>
                    <Trash2 size={18} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
          <View style={{ height: 40 }} />
        </ScrollView>
      ) : (
        properties.length === 0 ? (
          <View style={styles.centerContainer}>
            <Text style={{ fontSize: 16, color: '#64748b', marginBottom: 24 }}>No properties found.</Text>
            <TouchableOpacity style={[styles.btnPrimary, { paddingHorizontal: 24 }]} onPress={() => setIsAuthModalVisible(true)}>
               <Plus size={18} color="#fff" style={{marginRight: 8}}/>
               <Text style={styles.btnPrimaryText}>Create First Property</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView style={styles.container}>
            <View style={{ marginTop: 60, marginBottom: 32 }}>
              <Text style={{ fontSize: 32, fontWeight: 'bold', color: '#0f172a' }}>Welcome!</Text>
              <Text style={{ fontSize: 16, color: '#64748b', marginTop: 8 }}>Select a property to manage.</Text>
            </View>
            
            {properties.map(prop => (
               <View key={prop.id} style={styles.propertyCardBigWrapper}>
                 <TouchableOpacity 
                   activeOpacity={0.7}
                   style={styles.propertyCardBig} 
                   onPress={() => setActiveProperty(prop)}
                 >
                   <View style={styles.propertyCardIcon}>
                     <Building size={32} color="#3b82f6" />
                   </View>
                   <View style={{ flex: 1, paddingLeft: 16 }}>
                     <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#1e293b' }}>{prop.name}</Text>
                     <Text style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>{prop.location || 'No location set'}</Text>
                   </View>
                 </TouchableOpacity>
                 
                 <TouchableOpacity 
                   activeOpacity={0.6}
                   style={styles.propertyCardDeleteBtn} 
                   onPress={() => {
                     setDeletePropModal(prop);
                   }}
                 >
                   <Trash2 size={22} color="#ef4444" />
                 </TouchableOpacity>
               </View>
            ))}
            
            <TouchableOpacity style={[styles.btnOutline, { marginTop: 24 }]} onPress={() => setIsAuthModalVisible(true)}>
              <Plus size={18} color="#3b82f6" style={{marginRight: 8}}/>
              <Text style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: 16 }}>Add New Property</Text>
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
        )
      )}

      <Modal visible={!!editingRoom} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>Edit Room</Text>
            
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Room Number</Text>
              <TextInput 
                style={styles.input} 
                value={editingRoom?.room_number} 
                onChangeText={t => setEditingRoom({...editingRoom, room_number: t})} 
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Meter Number</Text>
              <TextInput 
                style={styles.input} 
                value={editingRoom?.meter_number} 
                onChangeText={t => setEditingRoom({...editingRoom, meter_number: t})} 
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Rent Amount</Text>
              <TextInput 
                style={styles.input} 
                value={editingRoom ? String(editingRoom.rent_amount) : ''} 
                keyboardType="numeric"
                onChangeText={t => setEditingRoom({...editingRoom, rent_amount: Number(t)})} 
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <TouchableOpacity style={[styles.btnPrimary, {flex: 1}]} onPress={handleEditSave}>
                <Text style={styles.btnPrimaryText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnGhost, {flex: 1}]} onPress={() => setEditingRoom(null)}>
                <Text style={{color: '#475569', fontWeight: '600'}}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!deletePropModal} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={[styles.cardTitle, { color: '#ef4444' }]}>Delete Property</Text>
            <Text style={{ color: '#64748b', marginBottom: 16 }}>
              This will permanently delete <Text style={{fontWeight:'bold', color:'#1e293b'}}>{deletePropModal?.name}</Text> and all its data.
              Type the property name below to confirm:
            </Text>
            
            <TextInput 
              style={[styles.input, { borderColor: '#fee2e2' }]} 
              placeholder={deletePropModal?.name}
              value={deleteConfirmText} 
              onChangeText={setDeleteConfirmText} 
            />

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
              <TouchableOpacity 
                style={[styles.btnPrimary, { flex: 1, backgroundColor: '#ef4444' }]} 
                onPress={handleDeleteProperty}
              >
                <Text style={styles.btnPrimaryText}>Delete Permanently</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.btnGhost, { flex: 1 }]} 
                onPress={() => {
                  setDeletePropModal(null);
                  setDeleteConfirmText('');
                }}
              >
                <Text style={{ color: '#475569', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, marginTop: 40 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#0f172a' },
  headerSubtitle: { fontSize: 14, color: '#64748b', marginTop: 2 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#0f172a', marginTop: 24, marginBottom: 12 },
  
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOffset: {width:0, height:1}, shadowOpacity: 0.05, shadowRadius: 3, elevation: 2 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#0f172a', marginBottom: 16 },
  
  roomCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', elevation: 1 },
  roomTitle: { fontSize: 16, fontWeight: 'bold', color: '#0f172a' },
  actionCol: { justifyContent: 'space-between', paddingLeft: 12, borderLeftWidth: 1, borderColor: '#f1f5f9' },
  iconBtn: { padding: 8 },
  
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#334155', marginBottom: 6 },
  input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  
  btnPrimary: { backgroundColor: '#3b82f6', borderRadius: 8, paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  btnGhost: { backgroundColor: '#f1f5f9', borderRadius: 8, paddingVertical: 12, justifyContent: 'center', alignItems: 'center' },
  btnOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#3b82f6', borderRadius: 8, paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  
  propertyCardBigWrapper: { flexDirection: 'row', marginBottom: 16, backgroundColor: '#fff', borderRadius: 16, elevation: 4, minHeight: 100, overflow: 'hidden' },
  propertyCardDeleteBtn: { backgroundColor: '#fee2e2', width: 70, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  propertyCardBig: { flex: 1, backgroundColor: '#fff', padding: 16, flexDirection: 'row', alignItems: 'center' },
  propertyCardIcon: { backgroundColor: '#eff6ff', borderRadius: 12, width: 56, height: 56, justifyContent: 'center', alignItems: 'center' },
  rowWrapper: { flexDirection: 'row', marginTop: 12 },

  badgeSuccess: { backgroundColor: '#dcfce7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start', marginTop: 8 },
  badgeSuccessText: { color: '#166534', fontSize: 12, fontWeight: '600' },
  badgeWarning: { backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start', marginTop: 8 },
  badgeWarningText: { color: '#92400e', fontSize: 12, fontWeight: '600' },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20 }
});
