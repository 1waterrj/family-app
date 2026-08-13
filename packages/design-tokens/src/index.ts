export const familyTokens = {
  color: {
    canvas: '#FFF9F0',
    surface: '#FFFFFF',
    ink: '#253238',
    mutedInk: '#5D6A70',
    child: {
      primary: '#7B61A8',
      secondary: '#197C83',
    },
    success: '#26734D',
    warning: '#9A5B00',
    danger: '#A12B2B',
    focus: '#155EEF',
  },
  radius: { small: 12, medium: 20, large: 28, pill: 999 },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  touch: { phoneMinimum: 48, dashboardMinimum: 64 },
  motion: { quickMs: 120, standardMs: 220 },
} as const;

export const statusPresentation = {
  AVAILABLE: { label: 'Ready', symbol: '○' },
  CLAIMED: { label: 'In progress', symbol: '▶' },
  AWAITING_APPROVAL: { label: 'Waiting for a grown-up', symbol: '…' },
  APPROVED: { label: 'Approved', symbol: '✓' },
  CLOSED: { label: 'Closed', symbol: '■' },
} as const;
