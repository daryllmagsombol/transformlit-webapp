import type { Metadata } from 'next';
import RegisterForm from './register-form';

export const metadata: Metadata = {
  title: 'Join TransformLit — Create Your Account',
};

export default function RegisterPage() {
  return <RegisterForm />;
}
