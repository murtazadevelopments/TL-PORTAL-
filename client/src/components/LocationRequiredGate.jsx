import GpsLocationModal from './GpsLocationModal';

export default function LocationRequiredGate({ onReady }) {
  return (
    <GpsLocationModal
      isOpen={true}
      canClose={false}
      onSuccess={onReady}
      title="Turn On GPS Location"
      description="You cannot access the portal without turning on GPS location. Please enable Location Services on your device and allow location access for this site."
    />
  );
}
