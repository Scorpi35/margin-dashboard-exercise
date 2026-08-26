import { Navigate, Route, Routes } from 'react-router-dom';

import PagePlaceholder from '@/components/PagePlaceholder';
import SidebarNav from '@/components/SidebarNav';
import CategoriesPage from '@/pages/CategoriesPage';
import DashboardPage from '@/pages/DashboardPage';
import ProjectDetailPage from '@/pages/ProjectDetailPage';
import ProductivityPage from '@/pages/ProductivityPage';
import ProjectsPage from '@/pages/ProjectsPage';
import SettingsPage from '@/pages/SettingsPage';
import UploadPage from '@/pages/UploadPage';

/**
 * The application shell: a persistent sidebar and the six routes the dashboard is
 * made of. Pages compose components and read their filters from the URL, so any
 * view is reproducible from a link.
 */
export default function App() {
  return (
    <div className="flex min-h-dvh flex-col sm:flex-row">
      <SidebarNav />

      <main className="min-w-0 flex-1 px-5 py-6 sm:px-8 sm:py-8">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:refCode" element={<ProjectDetailPage />} />
          <Route path="/productivity" element={<ProductivityPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route
            path="/404"
            element={
              <PagePlaceholder
                title="Page not found"
                description="That address does not match any part of the dashboard."
                plannedIn="nothing — check the link"
              />
            }
          />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
      </main>
    </div>
  );
}
