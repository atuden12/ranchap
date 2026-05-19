import { AdgMatrix } from './AdgMatrix';
import { BandSettings } from './BandSettings';
import { DataAdmin } from './DataAdmin';

export function Settings({ onImported }: { onImported?: () => void } = {}) {
  return (
    <div className="space-y-4">
      <DataAdmin onImported={onImported} />
      <BandSettings />
      <AdgMatrix />
    </div>
  );
}
