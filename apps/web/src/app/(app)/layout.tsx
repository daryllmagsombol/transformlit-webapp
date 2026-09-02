import { AuthenticatedLayout } from '../../components/layout/authenticated-layout';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
}
