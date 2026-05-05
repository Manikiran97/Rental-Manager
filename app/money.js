import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { Banknote, Bell, CheckCircle2, Download, FileDown, FileUp, History, Pencil, Scan, Search, Trash2 } from 'lucide-react-native';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import CustomDatePicker from '../src/components/CustomDatePicker';
import { PropertyContext } from '../src/context/PropertyContext';
import { defaultDB } from '../src/db';
import { scanBillWithGeminiNative } from '../src/utils/aiScanner';



const CollectRentModal = ({ payModal, onConfirm, onCancel }) => {
  const [form, setForm] = useState({
    amount: String(payModal.remaining),
    collectedBy: 'Mani',
    date: new Date(),
    method: 'Cash'
  });
  const [showPicker, setShowPicker] = useState(false);

  const handlePay = async () => {
    const amt = Number(form.amount);
    if (!amt || amt <= 0) return;

    await defaultDB.addPayment({
      due_id: payModal.id,
      amount_paid: amt,
      payment_date: form.date.toISOString().split('T')[0],
      method: form.method,
      collected_by: form.collectedBy
    });

    if (amt >= payModal.remaining) {
      await defaultDB.updateDueStatus(payModal.id, 'Paid');
    }

    // Send WhatsApp Receipt
    const t = payModal.t;
    if (t) {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dDate = new Date(payModal.due_date);
      const mon = `${months[dDate.getMonth()]} ${dDate.getFullYear()}`;

      const receiptMessage = `*Payment Receipt*\n\nHello ${t.name},\n\nWe have received your payment of *₹${amt}* for *${payModal.due_type} (${mon})*.\n\nRoom: ${payModal.r?.room_number || 'N/A'}\nDate: ${form.date.toLocaleDateString('en-GB')}\nMethod: ${form.method}\n\nThank you!`;

      const phone = t.phone.startsWith('91') ? t.phone : `91${t.phone}`;
      Linking.openURL(`whatsapp://send?phone=${phone}&text=${encodeURIComponent(receiptMessage)}`)
        .catch(() => Alert.alert('Error', 'WhatsApp is not installed.'));
    }

    onConfirm();
  };

  return (
    <Modal visible={true} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { maxHeight: '90%' }]}>
          <Text style={styles.cardTitle}>Collect Rent</Text>
          <Text style={{ marginBottom: 16, color: '#64748b' }}>Remaining Balance: ₹{payModal.remaining}</Text>

          <ScrollView>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Amount Paid (₹)</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={form.amount}
                onChangeText={t => setForm({ ...form, amount: t })}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Collected By</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {['Mani', 'Narahari'].map(person => (
                  <TouchableOpacity
                    key={person}
                    style={[styles.pillBtn, form.collectedBy === person && styles.pillBtnActive]}
                    onPress={() => setForm({ ...form, collectedBy: person })}
                  >
                    <Text style={form.collectedBy === person ? styles.pillTextActive : styles.pillText}>{person}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Collected Date</Text>
              <TouchableOpacity
                style={styles.input}
                onPress={() => setShowPicker(true)}
              >
                <Text style={{ fontSize: 16, color: '#1e293b' }}>{form.date.toLocaleDateString('en-GB')}</Text>
              </TouchableOpacity>
              <CustomDatePicker
                visible={showPicker}
                value={form.date}
                onChange={(d) => setForm({ ...form, date: d })}
                onClose={() => setShowPicker(false)}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Payment Method</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {['Cash', 'UPI'].map(m => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.pillBtn, form.method === m && styles.pillBtnActive]}
                    onPress={() => setForm({ ...form, method: m })}
                  >
                    <Text style={form.method === m ? styles.pillTextActive : styles.pillText}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <TouchableOpacity style={[styles.btnPrimary, { flex: 2 }]} onPress={handlePay}>
                <Text style={styles.btnPrimaryText}>Save Payment</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} onPress={onCancel}>
                <Text style={{ color: '#475569', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default function MoneyScreen() {
  const { activeProperty } = useContext(PropertyContext);
  const [dues, setDues] = useState([]);
  const [payments, setPayments] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [rooms, setRooms] = useState([]);

  const [payModalState, setPayModalState] = useState(null);
  const [apiKeyModal, setApiKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [selectedReminderDue, setSelectedReminderDue] = useState(null);
  const [reminderLogs, setReminderLogs] = useState([]);
  const [addDueModal, setAddDueModal] = useState(false);
  const [newDueForm, setNewDueForm] = useState({
    tenant_id: '',
    amount_due: '',
    due_date: new Date(),
    due_type: 'Rent',
    customType: ''
  });
  const [showManualPicker, setShowManualPicker] = useState(false);
  const [activeTab, setActiveTab] = useState('dues');
  const [duesSearch, setDuesSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyMonth, setHistoryMonth] = useState(new Date().getMonth());
  const [historyYear, setHistoryYear] = useState(new Date().getFullYear());
  const [editingDue, setEditingDue] = useState(null);
  const [showEditPicker, setShowEditPicker] = useState(false);
  const params = useLocalSearchParams();

  const formatDisplayDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('default', { month: 'short' });
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  };

  useEffect(() => {
    if (params.tab === 'history') {
      setActiveTab('history');
    }
  }, [params.tab]);

  // Grab the api key on mount
  useEffect(() => {
    AsyncStorage.getItem('GEMINI_API_KEY').then(key => {
      if (key) setTempApiKey(key);
    });
  }, []);

  const loadData = async () => {
    if (!activeProperty) return;
    const r = await defaultDB.getAllRooms();
    const propsRooms = r.filter(room => room.property_id === activeProperty.id);
    const propsRoomIds = propsRooms.map(x => x.id);

    const t = await defaultDB.getTenants();
    const propsTenants = t.filter(x => propsRoomIds.includes(x.room_id));
    const propsTenantIds = propsTenants.map(x => x.id);

    const alldues = await defaultDB.getDues();
    setDues(alldues.filter(x => propsTenantIds.includes(x.tenant_id)));
    setPayments(await defaultDB.getAllPayments());
    setRooms(propsRooms);
    setTenants(propsTenants);
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [activeProperty])
  );

  const handleRemind = async (due) => {
    const t = tenants.find(x => x.id === due.tenant_id);
    if (!t) return;

    // Find all pending dues for this tenant from our pre-processed list
    const tenantDues = sortedDuesList.filter(d => d.tenant_id === t.id);
    const r = rooms.find(x => x.id === t.room_id);

    let totalPending = 0;
    let duesText = '';

    tenantDues.forEach(d => {
      const dDate = new Date(d.due_date);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const mon = `${months[dDate.getMonth()]} ${dDate.getFullYear()}`;
      duesText += `• ${d.due_type} (${mon}): ₹${d.remaining}\n`;
      totalPending += d.remaining;
    });

    const message = `Hello ${t.name},\n\nThis is a friendly reminder regarding your pending dues for Room ${r?.room_number || 'N/A'}:\n\n${duesText}\n*Total Pending: ₹${totalPending}*\n\nThank you!`;

    // Increment count for all involved dues
    for (const d of tenantDues) {
      await defaultDB.incrementDueReminder(d.id);
    }
    loadData();

    const phone = t.phone.startsWith('91') ? t.phone : `91${t.phone}`;
    await Linking.openURL(`whatsapp://send?phone=${phone}&text=${encodeURIComponent(message)}`)
      .catch(() => Alert.alert('Error', 'WhatsApp is not installed on this device'));
  };

  const handleShowReminders = async (due) => {
    const logs = await defaultDB.getReminderLogs(due.id);
    setReminderLogs(logs);
    setSelectedReminderDue(due);
  };

  const handleDelete = (id) => {
    Alert.alert('Delete Due', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await defaultDB.deleteDue(id);
          loadData();
        }
      }
    ])
  };

  const processScannedImage = async (base64) => {
    const key = await AsyncStorage.getItem('GEMINI_API_KEY');
    setIsScanning(true);
    const aiResult = await scanBillWithGeminiNative(key, base64);
    setIsScanning(false);

    if (!aiResult.success) {
      Alert.alert("AI Model Error", aiResult.error || "Failed to extract values.");
      return;
    }

    // Map to Room
    const cleanMeter = String(aiResult.meter_number || '').trim();
    const cleanAmount = parseFloat(String(aiResult.amount || 0).replace(/[^\d.-]/g, '')) || 0;

    const matchedRoom = rooms.find(r => String(r.meter_number || '').trim() === cleanMeter);
    if (!matchedRoom) {
      Alert.alert("Unmapped", `Found Meter: ${cleanMeter}\nAmount: ₹${cleanAmount}\n\nBut this meter is not mapped to any room in this property.`);
      return;
    }

    const matchedTenant = tenants.find(t => t.room_id === matchedRoom.id && t.is_active);
    if (!matchedTenant) {
      Alert.alert("Vacant", `Flat ${matchedRoom.room_number} has no active tenant to assign the due to.`);
      return;
    }

    Alert.alert(
      "Bill Scanned Successfully!",
      `Flat: ${matchedRoom.room_number} (${matchedTenant.name})\nAmount: ₹${cleanAmount}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm & Save", style: "default", onPress: async () => {
            await defaultDB.addDue({
              tenant_id: matchedTenant.id,
              amount_due: cleanAmount,
              due_date: new Date().toISOString(),
              status: 'Pending',
              due_type: 'Electricity Bill'
            });
            loadData();
          }
        }
      ]
    );
  };

  const handleAutoScan = async () => {
    const key = await AsyncStorage.getItem('GEMINI_API_KEY');
    if (!key) {
      setApiKeyModal(true);
      return;
    }

    Alert.alert(
      "Scan Bill",
      "Choose an image source to scan.",
      [
        {
          text: "Camera",
          onPress: async () => {
            const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
            if (permissionResult.granted === false) {
              Alert.alert("Permission to access camera is required!");
              return;
            }
            const pickerResult = await ImagePicker.launchCameraAsync({
              mediaTypes: 'images',
              base64: true,
              quality: 0.8,
            });
            if (!pickerResult.canceled) {
              processScannedImage(pickerResult.assets[0].base64);
            }
          }
        },
        {
          text: "Gallery / Photos",
          onPress: async () => {
            const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (permissionResult.granted === false) {
              Alert.alert("Permission to access gallery is required!");
              return;
            }
            const pickerResult = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: 'images',
              base64: true,
              quality: 0.8,
            });
            if (!pickerResult.canceled) {
              processScannedImage(pickerResult.assets[0].base64);
            }
          }
        },
        { text: "Cancel", style: "cancel" }
      ]
    );

  };

  const saveApiKey = async () => {
    await AsyncStorage.setItem('GEMINI_API_KEY', tempApiKey);
    setApiKeyModal(false);
    Alert.alert("Success", "API Key Saved. You can now use Auto-Scan.");
  };

  const handleManualAdd = async () => {
    if (!newDueForm.tenant_id || !newDueForm.amount_due) {
      Alert.alert("Error", "Please fill required fields.");
      return;
    }
    await defaultDB.addDue({
      ...newDueForm,
      due_type: newDueForm.due_type === 'Other' ? (newDueForm.customType || 'Other') : newDueForm.due_type,
      due_date: newDueForm.due_date.toISOString().split('T')[0],
      amount_due: Number(newDueForm.amount_due),
      status: 'Pending'
    });
    setAddDueModal(false);
    setNewDueForm({ tenant_id: '', amount_due: '', due_date: new Date(), due_type: 'Rent', customType: '' });
    loadData();
  };

  const handleUpdateDue = async () => {
    if (!editingDue.amount_due) return;
    await defaultDB.updateDue({
      ...editingDue,
      due_type: editingDue.due_type === 'Other' ? (editingDue.customType || 'Other') : editingDue.due_type,
      due_date: new Date(editingDue.due_date).toISOString().split('T')[0],
      amount_due: Number(editingDue.amount_due)
    });
    setEditingDue(null);
    loadData();
  };

  const sortedDuesList = useMemo(() => {
    return dues.map(due => {
      const t = tenants.find(x => x.id === due.tenant_id);
      const r = rooms.find(x => x.id === t?.room_id);
      const paidSoFar = payments.filter(p => p.due_id === due.id).reduce((s, p) => s + Number(p.amount_paid), 0);
      const remaining = due.amount_due - paidSoFar;

      const dueDate = new Date(due.due_date);
      const today = new Date();
      const diffTime = today.getTime() - dueDate.getTime();
      const daysPending = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      return { ...due, t, r, remaining, paidSoFar, daysPending };
    }).filter(d => d.status === 'Pending' && (d.remaining > 0 || d.amount_due === 0 || isNaN(d.remaining)))
      .filter(d => {
        const search = duesSearch.toLowerCase();
        return (d.r?.room_number || '').toLowerCase().includes(search) ||
          (d.t?.name || '').toLowerCase().includes(search);
      })
      .sort((a, b) => (a.r?.room_number || '').localeCompare(b.r?.room_number || ''));
  }, [dues, tenants, rooms, payments, duesSearch]);

  const historyList = useMemo(() => {
    return payments.map(p => {
      const due = dues.find(d => d.id === p.due_id);
      const t = tenants.find(tx => tx.id === due?.tenant_id);
      const r = rooms.find(rx => rx.id === t?.room_id);
      return { ...p, t, r, due };
    })
      .filter(p => p.r) // Only show payments for this property
      .filter(p => {
        const d = new Date(p.payment_date);
        return d.getMonth() === historyMonth && d.getFullYear() === historyYear;
      })
      .filter(p => {
        const search = historySearch.toLowerCase();
        return (p.t?.name || '').toLowerCase().includes(search) ||
          (p.r?.room_number || '').toLowerCase().includes(search);
      })
      .sort((a, b) => b.created_at - a.created_at);
  }, [payments, dues, tenants, rooms, historySearch, historyMonth, historyYear]);

  const handleExportPayments = async () => {
    try {
      let csv = 'Payment Date,Flat,Tenant,Type,Due Date,Amount Paid,Method,Collector\n';
      historyList.forEach(p => {
        csv += `"${p.payment_date}","${p.r?.room_number}","${p.t?.name}","${p.due?.due_type}","${p.due?.due_date}",${p.amount_paid},"${p.method}","${p.collected_by}"\n`;
      });

      const now = new Date();
      const timestamp = `${now.getDate().toString().padStart(2, '0')}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getFullYear()}_${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}`;
      const propName = activeProperty.name.replace(/\s+/g, '_');
      const filename = `Payments_${propName}_${timestamp}.csv`;

      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        return;
      }

      const fileUri = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(fileUri, csv);
      await Sharing.shareAsync(fileUri);
    } catch (e) {
      Alert.alert("Export Failed", e.message);
    }
  };

  const handleExportDues = async () => {
    try {
      let csv = 'Room,Tenant,Type,Amount Due,Due Date,Status\n';
      sortedDuesList.forEach(d => {
        csv += `"${d.r?.room_number}","${d.t?.name}","${d.due_type}",${d.amount_due},"${d.due_date}","${d.status}"\n`;
      });

      const now = new Date();
      const timestamp = `${now.getDate().toString().padStart(2, '0')}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getFullYear()}_${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}`;
      const propName = activeProperty.name.replace(/\s+/g, '_');
      const filename = `Pending_Dues_${propName}_${timestamp}.csv`;

      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        return;
      }

      const fileUri = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(fileUri, csv);
      await Sharing.shareAsync(fileUri);
    } catch (e) {
      Alert.alert("Export Failed", e.message);
    }
  };

  const parseCSVDate = (dateStr) => {
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
        const M = String(d.getMonth() + 0 + 1).padStart(2, '0');
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

  const handleImportDues = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', '*/*']
      });
      if (result.canceled) return;
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const rows = content.split('\n').filter(r => r.trim());
      let count = 0;

      for (let i = 1; i < rows.length; i++) {
        const cols = rows[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
        if (cols.length >= 5) {
          const roomNum = cols[0];
          const tenantName = cols[1];
          const type = cols[2];
          const amount = parseFloat(cols[3]);
          const dueDateStr = cols[4];
          const status = cols[5] || 'Pending';

          const matchedRoom = rooms.find(r => r.room_number.toLowerCase() === roomNum.toLowerCase());
          if (matchedRoom) {
            const matchedTenant = tenants.find(t => t.room_id === matchedRoom.id && t.name.toLowerCase() === tenantName.toLowerCase());
            if (matchedTenant) {
              await defaultDB.addDue({
                tenant_id: matchedTenant.id,
                amount_due: amount,
                due_date: parseCSVDate(dueDateStr) || new Date().toISOString().split('T')[0],
                due_type: type,
                status: status
              });
              count++;
            }
          }
        }
      }
      Alert.alert("Success", `Imported ${count} dues!`);
      loadData();
    } catch (e) {
      Alert.alert("Import Failed", e.message);
    }
  };

  const handleImportPayments = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', '*/*']
      });
      if (result.canceled) return;
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const rows = content.split('\n').filter(r => r.trim());
      let count = 0;

      for (let i = 1; i < rows.length; i++) {
        const cols = rows[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
        if (cols.length >= 6) {
          const payDate = parseCSVDate(cols[0]);
          const roomNum = cols[1];
          const tenantName = cols[2];
          const type = cols[3];
          const dueDate = parseCSVDate(cols[4]);
          const amount = parseFloat(cols[5]);
          const method = cols[6] || 'Cash';
          const collector = cols[7] || 'Mani';

          // Clean room string (handle "Room 101" or just "101")
          const cleanRoomNum = roomNum.replace(/room/gi, '').trim();
          const matchedRoom = rooms.find(r => r.room_number.toLowerCase() === cleanRoomNum.toLowerCase());

          if (matchedRoom) {
            const matchedTenant = tenants.find(t => t.room_id === matchedRoom.id && t.name.toLowerCase() === tenantName.toLowerCase());

            if (matchedTenant) {
              const allDues = await defaultDB.getDuesByTenant(matchedTenant.id);
              let matchedDue = allDues.find(d => d.due_type === type && parseCSVDate(d.due_date) === dueDate);

              if (!matchedDue) {
                // Auto-create the due so we can attach the payment to it
                const dId = await defaultDB.addDue({
                  tenant_id: matchedTenant.id,
                  amount_due: amount,
                  due_date: dueDate || payDate || new Date().toISOString().split('T')[0],
                  due_type: type,
                  status: 'Pending'
                });
                matchedDue = { id: dId, amount_due: amount };
              }

              await defaultDB.addPayment({
                due_id: matchedDue.id,
                amount_paid: amount,
                payment_date: payDate || new Date().toISOString().split('T')[0],
                method: method,
                collected_by: collector
              });

              // Verify balance and update status
              const paymentsForDue = await defaultDB.getPaymentsByDue(matchedDue.id);
              const totalPaid = paymentsForDue.reduce((s, p) => s + Number(p.amount_paid), 0);
              if (totalPaid >= matchedDue.amount_due) {
                await defaultDB.updateDueStatus(matchedDue.id, 'Paid');
              }
              count++;
            }
          }
        }
      }
      Alert.alert(
        "Import Complete",
        `Successfully imported ${count} payment records.\n\nNote: If you don't see them, make sure you have selected the correct Month and Year in the History tab.`
      );
      loadData();
    } catch (e) {
      Alert.alert("Import Failed", e.message);
    }
  };

  if (!activeProperty) {
    return <View style={styles.centerContainer}><Text>No property active.</Text></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <Banknote size={28} color="#1e293b" />
          <View style={{ marginLeft: 12 }}>
            <Text style={styles.headerTitle}>Money & Dues</Text>
            <Text style={styles.headerSubtitle}>{activeProperty.name}</Text>
          </View>
        </View>

        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'dues' && styles.tabActive]}
            onPress={() => setActiveTab('dues')}
          >
            <Banknote size={18} color={activeTab === 'dues' ? '#2563eb' : '#64748b'} />
            <Text style={[styles.tabText, activeTab === 'dues' && styles.tabTextActive]}>Pending Dues</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'history' && styles.tabActive]}
            onPress={() => setActiveTab('history')}
          >
            <History size={18} color={activeTab === 'history' ? '#2563eb' : '#64748b'} />
            <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>History</Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'dues' ? (
          <>
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
              <TouchableOpacity style={[styles.scanBtn, { flex: 1, marginBottom: 0 }]} onPress={handleAutoScan} disabled={isScanning}>
                <Scan size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.scanBtnText}>{isScanning ? 'Scanning...' : 'Scan'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.scanBtn, { flex: 1, marginBottom: 0, backgroundColor: '#3b82f6' }]} onPress={() => setAddDueModal(true)}>
                <Pencil size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.scanBtnText}>Manual</Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
              <TouchableOpacity style={[styles.pillBtn, { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 0 }]} onPress={handleExportDues}>
                <Download size={16} color="#475569" style={{ marginRight: 8 }} />
                <Text style={{ color: '#475569', fontWeight: '600' }}>Export Dues</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.pillBtn, { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 0 }]} onPress={handleImportDues}>
                <FileUp size={16} color="#475569" style={{ marginRight: 8 }} />
                <Text style={{ color: '#475569', fontWeight: '600' }}>Import Dues</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.input, { flexDirection: 'row', alignItems: 'center', marginBottom: 16, paddingVertical: 0 }]}>
              <Search size={18} color="#64748b" style={{ marginRight: 8 }} />
              <TextInput
                placeholder="Search flat or tenant..."
                style={{ flex: 1, height: 44 }}
                value={duesSearch}
                onChangeText={setDuesSearch}
              />
            </View>

            {sortedDuesList.map(due => (
              <View key={due.id} style={styles.dueCard}>
                <View style={styles.dueRow}>
                  <View>
                    <Text style={styles.roomText}>Room {due.r?.room_number}</Text>
                    <Text style={styles.tenantText}>{due.t?.name}</Text>
                    <Text style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{due.due_type} • {formatDisplayDate(due.due_date)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.amountText}>₹{due.remaining}</Text>
                    {due.paidSoFar > 0 && <Text style={{ color: '#16a34a', fontSize: 12 }}>({due.paidSoFar} Paid)</Text>}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      {due.daysPending > 0 && <Text style={{ color: '#ef4444', fontSize: 11, fontWeight: 'bold' }}>{due.daysPending}d Pending </Text>}
                      <TouchableOpacity onPress={() => handleShowReminders(due)}>
                        <Text style={styles.reminderBadge}>🔔 RM: {due.reminder_count}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.actionCollect} onPress={() => setPayModalState(due)}>
                    <CheckCircle2 size={16} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold', marginLeft: 4 }}>Collect</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.actionEdit} onPress={() => setEditingDue({ ...due, due_date: new Date(due.due_date), customType: ['Rent', 'Maintenance', 'Electricity Bill', 'Water', 'Miscellaneous'].includes(due.due_type) ? '' : due.due_type, due_type: ['Rent', 'Maintenance', 'Electricity Bill', 'Water', 'Miscellaneous'].includes(due.due_type) ? due.due_type : 'Other' })}>
                    <Pencil size={16} color="#1e293b" />
                    <Text style={{ color: '#1e293b', fontSize: 12, fontWeight: 'bold', marginLeft: 4 }}>Edit</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.actionRemind} onPress={() => handleRemind(due)}>
                    <Bell size={16} color="#2563eb" />
                    <Text style={{ color: '#2563eb', fontSize: 12, fontWeight: 'bold', marginLeft: 4 }}>Remind</Text>
                  </TouchableOpacity>

                  <View style={{ flex: 1 }} />
                  <TouchableOpacity style={styles.iconBtn} onPress={() => handleDelete(due.id)}>
                    <Trash2 size={18} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        ) : (
          <>
            <View style={{ marginBottom: 16 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                {[...Array(12).keys()].map(m => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.pillBtn, historyMonth === m && styles.pillBtnActive, { marginRight: 8 }]}
                    onPress={() => setHistoryMonth(m)}
                  >
                    <Text style={historyMonth === m ? styles.pillTextActive : styles.pillText}>
                      {new Date(2000, m).toLocaleString('default', { month: 'short' })}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <View style={[styles.input, { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 0 }]}>
                  <Search size={18} color="#64748b" style={{ marginRight: 8 }} />
                  <TextInput
                    placeholder="Search tenant or room..."
                    style={{ flex: 1, height: 44 }}
                    value={historySearch}
                    onChangeText={setHistorySearch}
                  />
                </View>

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity style={[styles.pillBtn, { marginBottom: 0, paddingVertical: 12 }]} onPress={() => setHistoryYear(historyYear - 1)}>
                    <Text style={{ fontSize: 16 }}>◀</Text>
                  </TouchableOpacity>
                  <View style={{ justifyContent: 'center' }}>
                    <Text style={{ fontWeight: 'bold', fontSize: 16 }}>{historyYear}</Text>
                  </View>
                  <TouchableOpacity style={[styles.pillBtn, { marginBottom: 0, paddingVertical: 12 }]} onPress={() => setHistoryYear(historyYear + 1)}>
                    <Text style={{ fontSize: 16 }}>▶</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity style={[styles.exportBtn, { height: 44, paddingHorizontal: 12, backgroundColor: '#6366f1' }]} onPress={handleImportPayments}>
                  <FileUp size={20} color="#fff" />
                </TouchableOpacity>

                <TouchableOpacity style={[styles.exportBtn, { height: 44, paddingHorizontal: 12 }]} onPress={handleExportPayments}>
                  <FileDown size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>

            {historyList.map(p => (
              <View key={p.id} style={styles.dueCard}>
                <View style={styles.dueRow}>
                  <View>
                    <Text style={[styles.roomText, { fontSize: 16 }]}>Room {p.r?.room_number}</Text>
                    <Text style={styles.tenantText}>{p.t?.name}</Text>
                    <Text style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{p.due?.due_type} • {new Date(p.payment_date).toLocaleDateString()}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.amountText, { color: '#16a34a', fontSize: 18 }]}>+₹{p.amount_paid}</Text>
                    <Text style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>via {p.method} • {p.collected_by}</Text>
                  </View>
                </View>
              </View>
            ))}
            {historyList.length === 0 && (
              <Text style={{ textAlign: 'center', color: '#94a3b8', marginTop: 40 }}>No payment records found for {new Date(historyYear, historyMonth).toLocaleString('default', { month: 'long', year: 'numeric' })}.</Text>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {payModalState && (
        <CollectRentModal
          payModal={payModalState}
          onConfirm={() => { setPayModalState(null); loadData(); }}
          onCancel={() => setPayModalState(null)}
        />
      )}

      {selectedReminderDue && (
        <Modal visible={true} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
                <Text style={styles.cardTitle}>Reminder History</Text>
                <TouchableOpacity onPress={() => setSelectedReminderDue(null)}>
                  <Text style={{ color: '#ef4444', fontWeight: 'bold' }}>Close</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 300 }}>
                {reminderLogs.length === 0 ? (
                  <Text style={{ color: '#64748b', textAlign: 'center', marginVertical: 20 }}>No reminder logs found.</Text>
                ) : (
                  reminderLogs.map((log, idx) => (
                    <View key={log.id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: '#f1f5f9' }}>
                      <Text style={{ fontSize: 14, color: '#1e293b' }}>
                        {reminderLogs.length - idx}. {new Date(log.reminder_date).toLocaleDateString()} at {new Date(log.reminder_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {editingDue && (
        <Modal visible={true} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.cardTitle}>Edit Due</Text>
              <ScrollView style={{ maxHeight: '80%' }}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Tenant</Text>
                  <Text style={styles.input}>{editingDue.t?.name} (Room {editingDue.r?.room_number})</Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Due Type</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', gap: 8 }}>
                    {['Rent', 'Maintenance', 'Electricity Bill', 'Water', 'Miscellaneous', 'Other'].map(type => (
                      <TouchableOpacity
                        key={type}
                        style={[styles.pillBtn, editingDue.due_type === type && styles.pillBtnActive]}
                        onPress={() => setEditingDue({ ...editingDue, due_type: type })}
                      >
                        <Text style={editingDue.due_type === type ? styles.pillTextActive : styles.pillText}>{type}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                {editingDue.due_type === 'Other' && (
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Custom Due Type Name</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Security Deposit"
                      value={editingDue.customType}
                      onChangeText={t => setEditingDue({ ...editingDue, customType: t })}
                    />
                  </View>
                )}

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Amount (₹)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={String(editingDue.amount_due)}
                    onChangeText={t => setEditingDue({ ...editingDue, amount_due: t })}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Due Date</Text>
                  <TouchableOpacity
                    style={styles.input}
                    onPress={() => setShowEditPicker(true)}
                  >
                    <Text style={{ fontSize: 16, color: '#1e293b' }}>{new Date(editingDue.due_date).toLocaleDateString('en-GB')}</Text>
                  </TouchableOpacity>
                  <CustomDatePicker
                    visible={showEditPicker}
                    value={new Date(editingDue.due_date)}
                    onChange={(d) => setEditingDue({ ...editingDue, due_date: d })}
                    onClose={() => setShowEditPicker(false)}
                  />
                </View>

                <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                  <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={handleUpdateDue}>
                    <Text style={styles.btnPrimaryText}>Update Due</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} onPress={() => setEditingDue(null)}>
                    <Text style={{ color: '#475569', fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {addDueModal && (
        <Modal visible={true} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.cardTitle}>Add Due Manually</Text>
              <ScrollView style={{ maxHeight: '80%' }}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Select Tenant</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', gap: 8 }}>
                    {tenants.map(t => {
                      const r = rooms.find(room => room.id === t.room_id);
                      return (
                        <TouchableOpacity
                          key={t.id}
                          style={[styles.pillBtn, newDueForm.tenant_id === t.id && styles.pillBtnActive]}
                          onPress={() => setNewDueForm({ ...newDueForm, tenant_id: t.id })}
                        >
                          <Text style={newDueForm.tenant_id === t.id ? styles.pillTextActive : styles.pillText}>{t.name} (Room {r?.room_number})</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Due Type</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', gap: 8 }}>
                    {['Rent', 'Maintenance', 'Electricity Bill', 'Water', 'Miscellaneous', 'Other'].map(type => (
                      <TouchableOpacity
                        key={type}
                        style={[styles.pillBtn, newDueForm.due_type === type && styles.pillBtnActive]}
                        onPress={() => setNewDueForm({ ...newDueForm, due_type: type })}
                      >
                        <Text style={newDueForm.due_type === type ? styles.pillTextActive : styles.pillText}>{type}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                {newDueForm.due_type === 'Other' && (
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Custom Due Type Name</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Security Deposit"
                      value={newDueForm.customType}
                      onChangeText={t => setNewDueForm({ ...newDueForm, customType: t })}
                    />
                  </View>
                )}

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Amount (₹)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={String(newDueForm.amount_due)}
                    onChangeText={t => setNewDueForm({ ...newDueForm, amount_due: t })}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Due Date</Text>
                  <TouchableOpacity
                    style={styles.input}
                    onPress={() => setShowManualPicker(true)}
                  >
                    <Text style={{ fontSize: 16, color: '#1e293b' }}>{newDueForm.due_date.toLocaleDateString('en-GB')}</Text>
                  </TouchableOpacity>
                  <CustomDatePicker
                    visible={showManualPicker}
                    value={newDueForm.due_date}
                    onChange={(d) => setNewDueForm({ ...newDueForm, due_date: d })}
                    onClose={() => setShowManualPicker(false)}
                  />
                </View>

                <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                  <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={handleManualAdd}>
                    <Text style={styles.btnPrimaryText}>Add Due</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} onPress={() => setAddDueModal(false)}>
                    <Text style={{ color: '#475569', fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      <Modal visible={apiKeyModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>Google Gemini API Key required</Text>
            <Text style={{ marginBottom: 16, color: '#64748b' }}>To use the AI scanner, please provide your Google Gemini API key. This will be saved securely on your device.</Text>

            <TouchableOpacity
              onPress={() => Linking.openURL('https://aistudio.google.com/app/apikey')}
              style={{ marginBottom: 20, backgroundColor: '#f0f9ff', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#bae6fd' }}
            >
              <Text style={{ color: '#0369a1', fontSize: 13, textAlign: 'center', fontWeight: '600' }}>Get your API key from Google AI Studio ↗</Text>
            </TouchableOpacity>

            <View style={styles.inputGroup}>
              <TextInput
                style={styles.input}
                value={tempApiKey}
                onChangeText={setTempApiKey}
                placeholder="AIzaSy..."
                secureTextEntry
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={saveApiKey}>
                <Text style={styles.btnPrimaryText}>Save Key</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} onPress={() => setApiKeyModal(false)}>
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
  container: { flex: 1, padding: 16 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, marginTop: 40 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#0f172a' },
  headerSubtitle: { fontSize: 14, color: '#64748b', marginTop: 2 },

  scanBtn: { backgroundColor: '#8b5cf6', borderRadius: 12, paddingVertical: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 24, elevation: 3 },
  scanBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  dueCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, elevation: 2 },
  dueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  roomText: { fontSize: 18, fontWeight: 'bold', color: '#0f172a' },
  tenantText: { fontSize: 14, color: '#475569', marginTop: 2 },
  amountText: { fontSize: 20, fontWeight: 'bold', color: '#dc2626' },
  reminderBadge: { backgroundColor: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 'bold', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginTop: 4, overflow: 'hidden' },

  actionRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderColor: '#f1f5f9' },
  actionCollect: { backgroundColor: '#16a34a', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center', marginRight: 8 },
  actionEdit: { backgroundColor: '#f1f5f9', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center', marginRight: 8 },
  actionRemind: { backgroundColor: '#dbeafe', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center' },
  iconBtn: { padding: 8 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#0f172a', marginBottom: 16 },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#334155', marginBottom: 6 },
  input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  btnPrimary: { backgroundColor: '#2563eb', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  btnGhost: { backgroundColor: '#f1f5f9', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },

  pillBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 8 },
  pillBtnActive: { backgroundColor: '#dbeafe', borderColor: '#3b82f6' },
  pillText: { color: '#475569', fontWeight: '600', fontSize: 12 },
  pillTextActive: { color: '#1d4ed8', fontWeight: 'bold', fontSize: 12 },

  pickerArrow: { fontSize: 24, color: '#3b82f6', padding: 10 },
  pickerVal: { fontSize: 20, fontWeight: 'bold', color: '#0f172a' },

  tabContainer: { flexDirection: 'row', backgroundColor: '#e2e8f0', borderRadius: 12, padding: 4, marginBottom: 24 },
  tab: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 10, borderRadius: 10, gap: 8 },
  tabActive: { backgroundColor: '#fff', elevation: 2 },
  tabText: { fontSize: 14, fontWeight: '600', color: '#64748b' },
  tabTextActive: { color: '#1e293b' },

  exportBtn: { backgroundColor: '#10b981', paddingHorizontal: 12, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
});
