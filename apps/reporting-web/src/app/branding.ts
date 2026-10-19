/** The product name shown in the browser tab, title bar, sidebar and footer. Set `VITE_APP_TITLE` at build time. */
export const APP_TITLE: string = (import.meta.env.VITE_APP_TITLE as string | undefined) || 'QA Reporting';
