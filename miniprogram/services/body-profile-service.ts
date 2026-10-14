import type { BodyMeasurements, BodyProfile } from '../models/body-profile';
import type { BodyProfileRepository } from '../repositories/body-profile-repository';
import { assertBodyMeasurements } from '../utils/body-validation';

export class BodyProfileService {
  constructor(private readonly repository: BodyProfileRepository) {}

  get(): BodyProfile | null { return this.repository.get(); }

  save(input: BodyMeasurements): BodyProfile {
    assertBodyMeasurements(input);
    const profile: BodyProfile = { ...input, updatedAt: new Date().toISOString() };
    this.repository.save(profile);
    return profile;
  }
}
