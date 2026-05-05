import React from 'react';
import { Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

const CustomDatePicker = ({ visible, value, onChange, onClose }) => {
  if (!visible) return null;

  const handleDateChange = (event, selectedDate) => {
    // If user cancelled, dismiss
    if (event.type === 'dismissed') {
      onClose();
      return;
    }

    // If user selected a date
    if (selectedDate) {
      onChange(selectedDate);
    }
    
    // Always close on confirm/select
    onClose();
  };

  return (
    <DateTimePicker
      value={value ? new Date(value) : new Date()}
      mode="date"
      display={Platform.OS === 'android' ? 'calendar' : 'spinner'}
      onChange={handleDateChange}
      accentColor="#2563eb" // Matches your primary blue theme
    />
  );
};

export default CustomDatePicker;
