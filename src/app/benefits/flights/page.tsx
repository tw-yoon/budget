import { FlightsSection } from "@/components/benefits/FlightsSection";
import { ProOnly } from "@/components/ProOnly";

export const metadata = { title: "Flights · Benefits · Budget Claude" };

// Pro-only: comparing what a fare is worth across cards' points is a planning
// tool for a trip, not a view of the money already spent.
export default function BenefitsFlightsPage() {
  return (
    <ProOnly title="Flights" nested>
      <FlightsSection />
    </ProOnly>
  );
}
