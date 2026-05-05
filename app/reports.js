import React, { useState, useEffect, useContext, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions, RefreshControl, TouchableOpacity, Platform, Alert, Modal, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { PropertyContext } from '../src/context/PropertyContext';
import { defaultDB } from '../src/db';
import { FileText, TrendingUp, PieChart, Users, Banknote, Calendar, Printer } from 'lucide-react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

const { width } = Dimensions.get('window');

export default function ReportsScreen() {
  const { activeProperty } = useContext(PropertyContext);
  const [stats, setStats] = useState({
    totalCollected: 0,
    cashCollected: 0,
    upiCollected: 0,
    maniCollected: 0,
    narahariCollected: 0,
    pendingTotal: 0,
    typeBreakdown: {},
    roomSummaries: []
  });

  const formatDisplayDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('default', { month: 'short' });
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  };
  const [refreshing, setRefreshing] = useState(false);
  const [isResetModalVisible, setIsResetModalVisible] = useState(false);
  const [resetNameConfirm, setResetNameConfirm] = useState('');

  const loadReport = async () => {
    if (!activeProperty) return;
    
    // Fetch all data
    const allRooms = await defaultDB.getAllRooms();
    const rooms = allRooms.filter(r => r.property_id === activeProperty.id);
    const roomIds = rooms.map(r => r.id);
    
    const allTenants = await defaultDB.getTenants();
    const propTenants = allTenants.filter(t => roomIds.includes(t.room_id));
    const tenantIds = propTenants.map(t => t.id);

    const allDues = await defaultDB.getDues();
    const propDues = allDues.filter(d => tenantIds.includes(d.tenant_id));
    
    const allPayments = await defaultDB.getAllPayments();
    const propPayments = allPayments.filter(p => propDues.some(d => d.id === p.due_id));

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Calculations - Only for current month by default
    let total = 0, cash = 0, upi = 0, mani = 0, narahari = 0;
    const typeBreakdown = {};

    const currentMonthPayments = propPayments.filter(p => {
      const pDate = new Date(p.payment_date);
      return pDate.getMonth() === currentMonth && pDate.getFullYear() === currentYear;
    });

    currentMonthPayments.forEach(p => {
      const amt = Number(p.amount_paid) || 0;
      total += amt;
      if (p.method === 'Cash') cash += amt;
      if (p.method === 'UPI') upi += amt;
      if (p.collected_by === 'Mani') mani += amt;
      if (p.collected_by === 'Narahari') narahari += amt;
    });

    // Room Summaries
    const roomSummaries = rooms.map(room => {
      const roomTenants = propTenants.filter(t => t.room_id === room.id);
      const roomTenantIds = roomTenants.map(t => t.id);
      
      const roomDues = propDues.filter(d => roomTenantIds.includes(d.tenant_id));
      const roomPayments = propPayments.filter(p => roomDues.some(d => d.id === p.due_id));

      // Calculation Logic
      const isBeforeCurrentMonth = (dateStr) => {
        if (!dateStr) return false;
        const d = new Date(dateStr);
        return d.getFullYear() < currentYear || (d.getFullYear() === currentYear && d.getMonth() < currentMonth);
      };

      const prevDuesSum = roomDues
        .filter(d => isBeforeCurrentMonth(d.due_date))
        .reduce((s, d) => s + Number(d.amount_due), 0);
      
      const prevPaidSum = roomPayments
        .filter(p => isBeforeCurrentMonth(p.payment_date))
        .reduce((s, p) => s + Number(p.amount_paid), 0);

      const previousBalance = prevDuesSum - prevPaidSum;

      const currentMonthDues = roomDues.filter(d => {
        const dDate = new Date(d.due_date);
        return dDate.getMonth() === currentMonth && dDate.getFullYear() === currentYear;
      });

      const currentMonthDuesSum = currentMonthDues.reduce((s, d) => s + Number(d.amount_due), 0);

      const duesList = currentMonthDues
        .map(d => {
           const mon = new Date(d.due_date).toLocaleString('default', { month: 'short' });
           const typeShort = (d.due_type || '').replace(/Electricity Bill/g, 'EB');
           return `${typeShort} - ${mon} - ${d.amount_due}`;
        })
        .join('\n') || 'None';

      const totalPaidThisMonth = roomPayments.filter(p => {
        const pDate = new Date(p.payment_date);
        return pDate.getMonth() === currentMonth && pDate.getFullYear() === currentYear;
      }).reduce((s, p) => s + Number(p.amount_paid), 0);

      const totalDue = previousBalance + currentMonthDuesSum;
      const pending = totalDue - totalPaidThisMonth;

      const paidByList = roomPayments
        .filter(p => {
          const pDate = new Date(p.payment_date);
          return pDate.getMonth() === currentMonth && pDate.getFullYear() === currentYear;
        })
        .map(p => {
          const due = roomDues.find(d => d.id === p.due_id);
          const typeShort = (due?.due_type || 'Other').replace(/Electricity Bill/g, 'EB');
          return `${typeShort} - ${p.method} - ₹${p.amount_paid}`;
        })
        .join('\n') || 'None';

      return {
        room_number: room.room_number,
        previousBalance,
        duesList,
        totalDue,
        totalPaidThisMonth,
        pending,
        paidByList
      };
    }).sort((a,b) => a.room_number.localeCompare(b.room_number));

    setStats({
      totalCollected: total,
      cashCollected: cash,
      upiCollected: upi,
      maniCollected: mani,
      narahariCollected: narahari,
      pendingTotal: roomSummaries.reduce((s, r) => s + r.pending, 0),
      typeBreakdown,
      roomSummaries
    });
  };

  const handleExportPDF = async () => {
    try {
      let html = `
        <html>
          <head>
            <style>
              @page {
                size: A4;
                margin: 15mm;
              }
              body { 
                font-family: sans-serif; 
                margin: 0;
                padding: 0; 
                color: #1e293b; 
                font-size: 10px; 
                width: 100%;
              }
              .header { text-align: center; margin-bottom: 20px; width: 100%; }
              .property-name { font-size: 18px; font-weight: bold; color: #2563eb; }
              table { width: 100%; border-collapse: collapse; margin-top: 10px; table-layout: fixed; }
              th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; word-wrap: break-word; overflow: hidden; }
              th { background-color: #f1f5f9; color: #475569; font-weight: bold; text-transform: uppercase; font-size: 8px; }
              .pending { color: #dc2626; font-weight: bold; }
              .paid { color: #16a34a; font-weight: bold; }
              .breakdown { white-space: pre-wrap; font-size: 8px; color: #475569; }
              .summary-box { background-color: #1e293b; color: white; padding: 12px; border-radius: 6px; display: flex; justify-content: space-around; margin-bottom: 15px; width: 100%; }
              
              /* Column Widths */
              th:nth-child(1), td:nth-child(1) { width: 8%; }
              th:nth-child(2), td:nth-child(2) { width: 12%; }
              th:nth-child(3), td:nth-child(3) { width: 25%; }
              th:nth-child(4), td:nth-child(4) { width: 14%; }
              th:nth-child(5), td:nth-child(5) { width: 14%; }
              th:nth-child(6), td:nth-child(6) { width: 14%; }
              th:nth-child(7), td:nth-child(7) { width: 13%; }
            </style>
          </head>
          <body>
            <div class="header">
              <div class="property-name">${activeProperty.name}</div>
              <div>Financial Summary Table - ${new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</div>
              <div style="font-size: 10px; color: #64748b; margin-top: 5px;">
                Report Generated on: ${formatDisplayDate(new Date())} ${new Date().toLocaleTimeString('en-US', {hour12: false})}
              </div>
            </div>
            
            <div class="summary-box">
              <div style="text-align: center;">
                <div style="font-size: 10px; color: #94a3b8;">Total Collected</div>
                <div style="font-size: 18px; font-weight: bold;">₹${stats.totalCollected.toLocaleString('en-IN')}</div>
              </div>
              <div style="text-align: center;">
                <div style="font-size: 10px; color: #94a3b8;">Total Pending</div>
                <div style="font-size: 18px; font-weight: bold; color: #f87171;">₹${stats.pendingTotal.toLocaleString('en-IN')}</div>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Flat</th>
                  <th>Prev. Bal</th>
                  <th>Current Dues</th>
                  <th>Total Due</th>
                  <th>Paid (Month)</th>
                  <th>Total Pending</th>
                  <th>Paid By</th>
                </tr>
              </thead>
              <tbody>
      `;

      stats.roomSummaries.forEach(sum => {
        html += `
          <tr>
            <td style="font-weight: bold;">${sum.room_number}</td>
            <td>₹${sum.previousBalance.toLocaleString('en-IN')}</td>
            <td><div class="breakdown">${sum.duesList}</div></td>
            <td>₹${sum.totalDue.toLocaleString('en-IN')}</td>
            <td class="paid">₹${sum.totalPaidThisMonth.toLocaleString('en-IN')}</td>
            <td class="${sum.pending === 0 ? 'paid' : 'pending'}">₹${sum.pending.toLocaleString('en-IN')}</td>
            <td><div class="breakdown">${sum.paidByList}</div></td>
          </tr>
        `;
      });

      html += `
              </tbody>
            </table>
          </body>
        </html>`;

      const { uri } = await Print.printToFileAsync({ html });
      
      if (Platform.OS === 'web') {
        await Print.printAsync({ html });
      } else {
        const now = new Date();
        const timestamp = `${now.getDate().toString().padStart(2, '0')}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getFullYear()}_${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}`;
        const propName = activeProperty.name.replace(/\s+/g, '_');
        const filename = `Report_${propName}_${timestamp}.pdf`;
        const finalUri = FileSystem.cacheDirectory + filename;
        
        await FileSystem.moveAsync({
           from: uri,
           to: finalUri
        });
        
        await Sharing.shareAsync(finalUri);
      }
    } catch (e) {
      Alert.alert("Export Error", e.message);
    }
  };

  const handleResetNameSubmit = () => {
    if (resetNameConfirm.trim() === activeProperty.name) {
      setIsResetModalVisible(false);
      setResetNameConfirm('');
      confirmFinancialReset();
    } else {
      Alert.alert('Name Mismatch', 'Please type the property name exactly to confirm.');
    }
  };

  const confirmFinancialReset = () => {
    Alert.alert(
      "Confirm Destructive Action",
      "Are you absolutely sure? This will delete all financial history for this property permanently.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Yes, Reset Everything", 
          style: "destructive", 
          onPress: async () => {
            await defaultDB.clearFinancialData();
            loadReport();
            Alert.alert("Reset Complete", "All financial records have been cleared.");
          } 
        }
      ]
    );
  };

  const handleResetFinancials = () => {
    setIsResetModalVisible(true);
  };

  useFocusEffect(
    useCallback(() => {
      loadReport();
    }, [activeProperty])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadReport();
    setRefreshing(false);
  };

  if (!activeProperty) {
    return (
      <View style={styles.centerContainer}>
        <Text style={{ color: '#64748b' }}>Please select a property first.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={[styles.header, { justifyContent: 'space-between' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <FileText size={28} color="#1e293b" />
            <View style={{ marginLeft: 12 }}>
              <Text style={styles.headerTitle}>Financial Reports</Text>
              <Text style={styles.headerSubtitle}>{activeProperty.name}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.exportPdfBtn} onPress={handleExportPDF}>
             <Printer size={22} color="#2563eb" />
          </TouchableOpacity>
        </View>

        {/* Total Overview Card */}
        <View style={styles.mainCard}>
          <Text style={styles.sectionTitle}>Collection Overview</Text>
          <View style={styles.mainStatRow}>
            <View>
              <Text style={styles.statLabel}>Total Collected</Text>
              <Text style={[styles.statValue, { color: '#16a34a' }]}>₹{stats.totalCollected.toLocaleString('en-IN')}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.statLabel}>Total Pending</Text>
              <Text style={[styles.statValue, { color: '#dc2626' }]}>₹{stats.pendingTotal.toLocaleString('en-IN')}</Text>
            </View>
          </View>
        </View>

        {/* Collector Breakdown */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <Users size={20} color="#3b82f6" />
            <Text style={[styles.cardTitle, { marginLeft: 8 }]}>Collected By</Text>
          </View>
          <View style={styles.barItem}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={styles.barLabel}>Mani</Text>
              <Text style={styles.barValue}>₹{stats.maniCollected.toLocaleString('en-IN')}</Text>
            </View>
            <View style={styles.barBg}>
              <View style={[styles.barFill, { width: `${(stats.maniCollected / (stats.totalCollected || 1)) * 100}%`, backgroundColor: '#3b82f6' }]} />
            </View>
          </View>
          <View style={styles.barItem}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={styles.barLabel}>Narahari</Text>
              <Text style={styles.barValue}>₹{stats.narahariCollected.toLocaleString('en-IN')}</Text>
            </View>
            <View style={styles.barBg}>
              <View style={[styles.barFill, { width: `${(stats.narahariCollected / (stats.totalCollected || 1)) * 100}%`, backgroundColor: '#8b5cf6' }]} />
            </View>
          </View>
        </View>

        {/* Method Breakdown */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <Banknote size={20} color="#10b981" />
            <Text style={[styles.cardTitle, { marginLeft: 8 }]}>Payment Methods</Text>
          </View>
          <View style={styles.row}>
            <View style={[styles.miniCard, { backgroundColor: '#f0fdf4' }]}>
              <Text style={styles.miniLabel}>Cash</Text>
              <Text style={[styles.miniValue, { color: '#15803d' }]}>₹{stats.cashCollected.toLocaleString('en-IN')}</Text>
            </View>
            <View style={[styles.miniCard, { backgroundColor: '#eff6ff' }]}>
              <Text style={styles.miniLabel}>UPI</Text>
              <Text style={[styles.miniValue, { color: '#1d4ed8' }]}>₹{stats.upiCollected.toLocaleString('en-IN')}</Text>
            </View>
          </View>
        </View>

        {/* Flat-wise Summary */}
        <View style={{ marginTop: 8 }}>
          <Text style={[styles.sectionTitle, { color: '#1e293b', marginBottom: 12 }]}>Flat-wise Summary</Text>
          {stats.roomSummaries.map((sum, idx) => (
            <View key={idx} style={styles.summaryCard}>
              <View style={styles.summaryHeader}>
                <Text style={styles.roomLabel}>Flat {sum.room_number}</Text>
                <View style={sum.pending > 0 ? styles.badgeError : styles.badgeSuccess}>
                   <Text style={sum.pending > 0 ? styles.badgeErrorText : styles.badgeSuccessText}>
                     {sum.pending > 0 ? 'Due' : 'Clear'}
                   </Text>
                </View>
              </View>

              <View style={styles.summaryRow}>
                <Text style={styles.detailLabel}>Previous Balance:</Text>
                <Text style={[styles.detailValue, { color: '#f59e0b' }]}>₹{sum.previousBalance.toLocaleString('en-IN')}</Text>
              </View>

              <View style={styles.summaryRow}>
                <Text style={styles.detailLabel}>Current Dues:</Text>
                <Text style={styles.detailValue}>{sum.duesList}</Text>
              </View>

              <View style={styles.summaryRow}>
                <Text style={styles.detailLabel}>Total Due:</Text>
                <Text style={styles.detailValue}>₹{sum.totalDue.toLocaleString('en-IN')}</Text>
              </View>

              <View style={styles.summaryRow}>
                <Text style={styles.detailLabel}>Total Amount Paid:</Text>
                <Text style={[styles.detailValue, { color: '#16a34a' }]}>₹{sum.totalPaidThisMonth.toLocaleString('en-IN')}</Text>
              </View>

              <View style={styles.summaryRow}>
                <Text style={styles.detailLabel}>Total Pending:</Text>
                <Text style={[styles.detailValue, { color: '#dc2626' }]}>₹{sum.pending.toLocaleString('en-IN')}</Text>
              </View>

              <View style={[styles.summaryRow, { borderBottomWidth: 0, marginTop: 8 }]}>
                <Text style={styles.detailLabel}>Paid By (This Month):</Text>
              </View>
              <View style={styles.breakdownBox}>
                <Text style={styles.breakdownText}>{sum.paidByList}</Text>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity 
          style={styles.resetBtn} 
          onPress={handleResetFinancials}
        >
          <Text style={styles.resetBtnText}>Reset Financial Data</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={isResetModalVisible} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={[styles.cardTitle, { color: '#dc2626' }]}>Verify Property Name</Text>
            <Text style={{ color: '#64748b', marginBottom: 16 }}>
              To reset financial data, please type the property name below: 
              {"\n"}<Text style={{ fontWeight: 'bold', color: '#1e293b' }}>{activeProperty.name}</Text>
            </Text>
            
            <View style={styles.inputGroup}>
              <TextInput 
                style={styles.input} 
                value={resetNameConfirm} 
                onChangeText={setResetNameConfirm} 
                placeholder="Type property name here"
                autoCapitalize="none"
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <TouchableOpacity style={[styles.btnPrimary, {flex: 1, backgroundColor: '#dc2626'}]} onPress={handleResetNameSubmit}>
                <Text style={styles.btnPrimaryText}>Verify & Continue</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnGhost, {flex: 1}]} onPress={() => {
                  setIsResetModalVisible(false);
                  setResetNameConfirm('');
              }}>
                <Text style={{color: '#475569', fontWeight: '600'}}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, marginTop: 40 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#0f172a' },
  headerSubtitle: { fontSize: 14, color: '#64748b', marginTop: 2 },
  exportPdfBtn: { padding: 10, backgroundColor: '#dbeafe', borderRadius: 10 },
  
  mainCard: { backgroundColor: '#1e293b', borderRadius: 16, padding: 20, marginBottom: 16, elevation: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#94a3b8', marginBottom: 16, textTransform: 'uppercase' },
  mainStatRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statLabel: { fontSize: 13, color: '#e2e8f0', marginBottom: 4 },
  statValue: { fontSize: 24, fontWeight: 'bold' },

  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 16, elevation: 2 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: '#1e293b' },
  
  barItem: { marginBottom: 16 },
  barLabel: { fontSize: 14, color: '#475569', fontWeight: '500' },
  barValue: { fontSize: 14, color: '#1e293b', fontWeight: 'bold' },
  barBg: { height: 8, backgroundColor: '#f1f5f9', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },

  row: { flexDirection: 'row', gap: 12 },
  miniCard: { flex: 1, padding: 16, borderRadius: 12 },
  miniLabel: { fontSize: 12, color: '#475569', marginBottom: 4, fontWeight: 'bold' },
  miniValue: { fontSize: 18, fontWeight: 'bold' },

  typeItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  typeLabel: { fontSize: 14, color: '#475569' },
  typeValue: { fontSize: 14, color: '#1e293b', fontWeight: '600' },

  summaryCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 16, elevation: 2 },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  roomLabel: { fontSize: 18, fontWeight: 'bold', color: '#1e293b' },
  summaryRow: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderColor: '#f8fafc' },
  detailLabel: { flex: 1.2, fontSize: 13, color: '#64748b', fontWeight: '500' },
  detailValue: { flex: 2, fontSize: 13, color: '#1e293b', fontWeight: '600' },
  
  breakdownBox: { backgroundColor: '#f8fafc', borderRadius: 8, padding: 12, marginTop: 4 },
  breakdownText: { fontSize: 12, color: '#475569', lineHeight: 20 },

  badgeSuccess: { backgroundColor: '#dcfce7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeSuccessText: { color: '#15803d', fontSize: 11, fontWeight: 'bold' },
  badgeError: { backgroundColor: '#fee2e2', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeErrorText: { color: '#b91c1c', fontSize: 11, fontWeight: 'bold' },

  resetBtn: { marginTop: 24, paddingVertical: 14, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#fee2e2', alignItems: 'center' },
  resetBtnText: { color: '#dc2626', fontWeight: 'bold', fontSize: 14 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#0f172a', marginBottom: 16 },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#334155', marginBottom: 6 },
  input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  btnPrimary: { backgroundColor: '#3b82f6', borderRadius: 8, paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  btnGhost: { backgroundColor: '#f1f5f9', borderRadius: 8, paddingVertical: 12, justifyContent: 'center', alignItems: 'center' },
});
