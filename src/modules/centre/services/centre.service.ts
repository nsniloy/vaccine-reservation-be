import { CACHE_MANAGER, Inject, Injectable, Logger } from '@nestjs/common';
import { AssignNurseDto } from '../dto/assign-nurse.dto';
import { CreateCentreDto } from '../dto/create-centre.dto';
import { ISlot } from '../entities/definitions/slot.interface';
import { CentreRepository } from '../repository/definitions/centre.repository.abstract';
import * as moment from 'moment-timezone'
import { SlotRepository } from '../repository/definitions/slot.repository.abstract';
import { NurseHistoryRepository } from '../repository/definitions/nurse-history.repository.abstract';
import { Cache } from 'cache-manager';

@Injectable()
export class CentreService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly centreRepository: CentreRepository,
    private readonly slotRepository: SlotRepository,
    private readonly nurseHistoryRepository: NurseHistoryRepository,
  ) { }
  async create(createCentreDto: CreateCentreDto) {
    let created_centre = await this.centreRepository.create(createCentreDto);
    this.resetCache()
    return created_centre
  }

  async findAll() {
    let all_centres = JSON.parse(await this.cache.get('reservation-centres'))
    if (!all_centres) {
      all_centres = await this.centreRepository.findAll()
      await this.cache.set('reservation-centres', JSON.stringify(all_centres), { ttl: 60 * 60 * 24 })
    }
    return all_centres;
  }

  async findOne(id:string) {
    return await this.centreRepository.findOne(id);
  }

  async remove(id: string) {
    await this.centreRepository.remove(id);
    this.resetCache()
    //removing unbooked slots for the deleted center
    await this.slotRepository.removeByCentreId(id)
    return
  }

  async assignNurse(assignNurseDto: AssignNurseDto) {
    let centre = await this.centreRepository.findOne(assignNurseDto.centre_id)
    let slots: ISlot[] = this.generateSlots(assignNurseDto, centre.vaccination_duration)
    let created_slots: ISlot[] = await this.slotRepository.createMany(slots)

    //adding nurses to history collection
    await this.nurseHistoryRepository.create({
      centre_id: centre._id,
      centre_name: centre.name,
      ...assignNurseDto
    })
    return {
      slots: created_slots
    }
  }

  async getSlotAndUpdateQuota(centre_id: string, date: Date, session: any) {
    let start_time = moment(date).startOf('day').format()
    let end_time = moment(date).endOf('day').format()
    return await this.slotRepository.reserveSlot(
      centre_id,
      new Date(start_time),
      new Date(end_time),
      session
    )
  }

  async undoSlotBooking(id: string, session: any) {
    await this.slotRepository.increaseQuota(id, 1, session)
  }

  private generateSlots(assignNurseDto: AssignNurseDto, duration: number): ISlot[] {
    let start_time = moment(assignNurseDto.start_time)
    let end_time = moment(assignNurseDto.end_time)
    let { centre_id } = assignNurseDto
    let slots: ISlot[] = []
    while (start_time.isBefore(end_time)) {
      let date = new Date(start_time.format())
      let quota_remaining = assignNurseDto.number_of_nurses
      slots.push({
        date,
        centre_id,
        quota_remaining
      })
      start_time = start_time.add(duration, 'minutes')
    }
    return slots
  }

  private async resetCache(){
    let all_centres = await this.centreRepository.findAll()
    this.cache.set('reservation-centres', JSON.stringify(all_centres), { ttl: 60 * 60 * 24 })
  }
}
