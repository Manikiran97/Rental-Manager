import React, { useState, useContext, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { PropertyContext } from '../src/context/PropertyContext';
import { defaultDB } from '../src/db';
import { Building, Users, Banknote, TrendingUp, AlertCircle } from 'lucide-react-native';

const CARD_WIDTH = Dimensions.get('window').width / 2 - 24;

export default function DashboardScreen() {
  const { activeProperty } = useContext(PropertyContext);
  const router = useRouter();
  const [metrics, setMetrics] = useState({
     totalRooms: 0, occupied: 0, 
     totalExpectedRent: 0,
     totalPendingDues: 0,
     totalCollectedThisMonth: 0,
  });
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    if (!activeProperty) return;
    
    // Fetch specifically isolated datastore elements
    const allRooms = await defaultDB.getAllRooms();
    const rooms = allRooms.filter(r => r.property_id === activeProperty.id);
    const roomIds = rooms.map(r => r.id);
    const allTenants = await defaultDB.getTenants();
    const propertyTenants = allTenants.filter(t => roomIds.includes(t.room_id));
    
    const expectedRent = rooms.reduce((sum, r) => sum + (Number(r.rent_amount) || 0), 0);
    
    const allDues = await defaultDB.getDues();
    const propertyDues = allDues.filter(d => propertyTenants.some(t => t.id === d.tenant_id));
    
    const allPayments = await defaultDB.getAllPayments();
    
    // Pending math
    let pending = 0;
    const pendingDues = propertyDues.filter(d => d.status === 'Pending');
    pendingDues.forEach(due => {
       const paid = allPayments.filter(p => p.due_id === due.id).reduce((s, p) => s + Number(p.amount_paid), 0);
       pending += (due.amount_due - paid);
    });
    
    // Determine collected this month
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const collected = allPayments.filter(p => {
       const d = new Date(p.payment_date);
       return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }).filter(p => {
       const dueInfo = propertyDues.find(d => d.id === p.due_id);
       return !!dueInfo;
    }).reduce((s, p) => s + Number(p.amount_paid), 0);

    setMetrics({
       totalRooms: rooms.length,
       occupied: propertyTenants.filter(t => t.is_active).length,
       totalExpectedRent: expectedRent,
       totalPendingDues: pending,
       totalCollectedThisMonth: collected
    });
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [activeProperty])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  if (!activeProperty) {
    return (
       <View style={styles.centerContainer}>
         <AlertCircle size={48} color="#94a3b8" />
         <Text style={{ marginTop: 16, color: '#475569', fontSize: 16 }}>Select a Property from the Flats tab first.</Text>
       </View>
    );
  }

  const occupancyRate = metrics.totalRooms > 0 ? Math.round((metrics.occupied / metrics.totalRooms) * 100) : 0;

  return (
    <View style={styles.container}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Dashboard</Text>
          <Text style={styles.headerSubtitle}>{activeProperty.name}</Text>
        </View>

        <View style={styles.row}>
          <TouchableOpacity style={styles.card} onPress={() => router.push('/')}>
            <View style={[styles.iconWrapper, { backgroundColor: '#dbeafe' }]}>
              <Building size={20} color="#2563eb" />
            </View>
            <Text style={styles.cardValue}>{metrics.totalRooms}</Text>
            <Text style={styles.cardLabel}>Total Flats</Text>
          </TouchableOpacity>
          
          <View style={styles.card}>
            <View style={[styles.iconWrapper, { backgroundColor: '#fef3c7' }]}>
              <Users size={20} color="#d97706" />
            </View>
            <Text style={styles.cardValue}>{metrics.occupied}</Text>
            <Text style={styles.cardLabel}>Occupied</Text>
            <Text style={styles.cardIndicator}>{occupancyRate}% Full</Text>
          </View>
        </View>

        <View style={styles.row}>
          <TouchableOpacity style={styles.card} onPress={() => router.push('/money')}>
            <View style={[styles.iconWrapper, { backgroundColor: '#fee2e2' }]}>
              <Banknote size={20} color="#dc2626" />
            </View>
            <Text style={[styles.cardValue, { color: '#dc2626' }]}>&#8377; {metrics.totalPendingDues}</Text>
            <Text style={styles.cardLabel}>Pending Dues</Text>
          </TouchableOpacity>
          
          <View style={styles.card}>
            <View style={[styles.iconWrapper, { backgroundColor: '#dcfce7' }]}>
              <TrendingUp size={20} color="#16a34a" />
            </View>
            <Text style={[styles.cardValue, { color: '#16a34a' }]}>&#8377; {metrics.totalExpectedRent}</Text>
            <Text style={styles.cardLabel}>Potential Monthly Rent</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.fullWidthCard} onPress={() => router.push({ pathname: '/money', params: { tab: 'history' } })}>
           <Text style={styles.cardLabel}>Collected This Month</Text>
           <Text style={[styles.cardValue, { fontSize: 32, marginTop: 4, color: '#0f172a' }]}>&#8377; {metrics.totalCollectedThisMonth}</Text>
        </TouchableOpacity>
        
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { padding: 16 },
  header: { marginBottom: 24, marginTop: 40 },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#0f172a' },
  headerSubtitle: { fontSize: 16, color: '#64748b', marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  card: { width: CARD_WIDTH, backgroundColor: '#fff', borderRadius: 16, padding: 16, elevation: 2, shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.05, shadowRadius: 3 },
  fullWidthCard: { backgroundColor: '#fff', borderRadius: 16, padding: 24, elevation: 2, shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.05, shadowRadius: 3 },
  iconWrapper: { padding: 8, borderRadius: 8, alignSelf: 'flex-start', marginBottom: 12 },
  cardValue: { fontSize: 24, fontWeight: 'bold', color: '#0f172a' },
  cardLabel: { fontSize: 13, color: '#64748b', marginTop: 4, fontWeight: '500' },
  cardIndicator: { fontSize: 11, color: '#2563eb', fontWeight: 'bold', marginTop: 8 }
});
