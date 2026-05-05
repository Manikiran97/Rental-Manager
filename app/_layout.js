import React, { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { PropertyProvider } from '../src/context/PropertyContext';
import { Home, Users, Banknote, FileText, LayoutDashboard } from 'lucide-react-native';
import { defaultDB } from '../src/db';

export default function RootLayout() {
  return (
    <PropertyProvider>
      <Tabs screenOptions={{ tabBarActiveTintColor: '#2563eb' }}>
        <Tabs.Screen 
          name="index" 
          options={{
            title: 'Flats',
            tabBarIcon: ({ color }) => <Home color={color} size={24} />
          }} 
        />
        <Tabs.Screen 
          name="dashboard" 
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ color }) => <LayoutDashboard color={color} size={24} />
          }} 
        />
        <Tabs.Screen 
          name="tenants" 
          options={{
            title: 'Tenants',
            tabBarIcon: ({ color }) => <Users color={color} size={24} />
          }} 
        />
        <Tabs.Screen 
          name="money" 
          options={{
            title: 'Money & Dues',
            tabBarIcon: ({ color }) => <Banknote color={color} size={24} />
          }} 
        />
        <Tabs.Screen 
          name="reports" 
          options={{
            title: 'Reports',
            tabBarIcon: ({ color }) => <FileText color={color} size={24} />
          }} 
        />
      </Tabs>
    </PropertyProvider>
  );
}
