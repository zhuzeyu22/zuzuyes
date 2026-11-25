import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './theme.jsx';
import Layout from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import Browse from './pages/Browse.jsx';
import CategoryPage from './pages/CategoryPage.jsx';
import AlgorithmPage from './pages/AlgorithmPage.jsx';
import CompareList from './pages/CompareList.jsx';
import ComparePage from './pages/ComparePage.jsx';
import LearningPath from './pages/LearningPath.jsx';

export default function App() {
  return (
    <ThemeProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/category/:catId" element={<CategoryPage />} />
          <Route path="/algorithm/:id" element={<AlgorithmPage />} />
          <Route path="/compare" element={<CompareList />} />
          <Route path="/compare/:group" element={<ComparePage />} />
          <Route path="/path" element={<LearningPath />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </ThemeProvider>
  );
}
