import type { ComponentType } from 'react';
import type { SvgIconProps } from '@mui/material';
import {
  SpaceDashboardRounded as DashboardIcon,
  ChecklistRounded as TestCasesIcon,
  BugReportRounded as BugReportIcon,
  RuleFolderRounded as ResolutionQueueIcon,
  PlayCircleFilledWhiteRounded as RegressionRunsIcon,
} from '@mui/icons-material';

export interface NavItem {
  path: string;
  label: string;
  icon: ComponentType<SvgIconProps>;
}

export const navItems: NavItem[] = [
  { path: '/', label: 'Test Cases', icon: TestCasesIcon },
  { path: '/regression-runs', label: 'Regression Runs', icon: RegressionRunsIcon },
  { path: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
  { path: '/resolution-queue', label: 'Resolution Queue', icon: ResolutionQueueIcon },
  { path: '/defects', label: 'Defects', icon: BugReportIcon },
];
