import React, { createContext, useState, useEffect } from 'react';
import { defaultDB } from '../db';

export const PropertyContext = createContext();

export const PropertyProvider = ({ children }) => {
  const [activeProperty, setActiveProperty] = useState(null);
  const [properties, setProperties] = useState([]);

  const loadProperties = async () => {
    const props = await defaultDB.getProperties();
    setProperties(props);
  };

  useEffect(() => {
    loadProperties();
  }, []);

  return (
    <PropertyContext.Provider value={{ activeProperty, setActiveProperty, properties, loadProperties }}>
      {children}
    </PropertyContext.Provider>
  );
};
