import AuthRedirect from './auth-redirect';
import { HomeNav } from '../components/home/home-nav';
import { Hero } from '../components/home/hero';
import { WhoWeAre } from '../components/home/who-we-are';
import { MoveSystem } from '../components/home/move-system';
import { PartnerCta } from '../components/home/partner-cta';
import { CommunityGateway } from '../components/home/community-gateway';
import { Announcements } from '../components/home/announcements';
import { PartnersStrip } from '../components/home/partners-strip';
import { HomeFooter } from '../components/home/home-footer';

export default function HomePage() {
  return (
    <AuthRedirect>
      <HomeNav />
      <main>
        <Hero />
        <WhoWeAre />
        <MoveSystem />
        <PartnerCta />
        <CommunityGateway />
        <Announcements />
        <PartnersStrip />
      </main>
      <HomeFooter />
    </AuthRedirect>
  );
}