import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { CssBaseline, StyledEngineProvider, ThemeProvider } from '@mui/material';
import { StoreProvider } from './app/store/provider';
import { theme } from './app/theme';
import Layout from './app/layout/Layout';
import { DashboardPage } from './features/dashboard-summary';
import { DefectListPage } from './features/defect-signature-list';
import { RegressionRunDetailPage, RegressionRunListPage } from './features/regression-run';
import { ResolutionIssueDetailPage, ResolutionQueuePage } from './features/resolution-queue';
import { RunDetailPage } from './features/run-detail';
import { TestCaseListPage } from './features/testcase-list';
import { TestCaseDetailPage } from './features/testcase-detail';

function App() {
  return (
    // `injectFirst` puts MUI's generated styles ahead of the Tailwind stylesheet. MUI class
    // selectors and Tailwind utilities have identical specificity, so without this the later
    // sheet wins by accident and utility classes on MUI components are silently dropped.
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <StoreProvider>
          <Router>
            <Layout>
              <Routes>
                <Route path="/" element={<TestCaseListPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/test-cases/:id" element={<TestCaseDetailPage />} />
                <Route path="/runs/:id" element={<RunDetailPage />} />
                <Route path="/defects" element={<DefectListPage />} />
                <Route path="/resolution-queue" element={<ResolutionQueuePage />} />
                <Route path="/resolution-queue/:id" element={<ResolutionIssueDetailPage />} />
                <Route path="/regression-runs" element={<RegressionRunListPage />} />
                <Route path="/regression-runs/:id" element={<RegressionRunDetailPage />} />
                {/* TODO: Add more routes for features */}
              </Routes>
            </Layout>
          </Router>
        </StoreProvider>
      </ThemeProvider>
    </StyledEngineProvider>
  );
}

export default App;
