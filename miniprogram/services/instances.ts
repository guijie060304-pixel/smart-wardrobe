import { LocalGarmentRepository } from '../repositories/garment-repository';
import { GarmentService } from './garment-service';
import { LocalBodyProfileRepository } from '../repositories/body-profile-repository';
import { BodyProfileService } from './body-profile-service';
import { LocalOutfitRepository } from '../repositories/outfit-repository';
import { OutfitService } from './outfit-service';
import { LocalOutfitCalendarRepository } from '../repositories/outfit-calendar-repository';
import { OutfitCalendarService } from './outfit-calendar-service';

export const garmentService = new GarmentService(new LocalGarmentRepository());
export const bodyProfileService = new BodyProfileService(new LocalBodyProfileRepository());
export const outfitService = new OutfitService(new LocalOutfitRepository(), garmentService);
export const outfitCalendarService = new OutfitCalendarService(new LocalOutfitCalendarRepository(), outfitService, garmentService);
