import { AuthenticatedLayout } from '../../components/layout/authenticated-layout';

export default function AppLayout({ children }: { readonly children: React.ReactNode }) {
  return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
}
