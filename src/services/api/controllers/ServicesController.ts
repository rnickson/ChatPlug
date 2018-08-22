import TOML from '@iarna/toml'
import { classToPlain } from 'class-transformer'
import path from 'path'
import {
  BadRequestError,
  BodyParam,
  Get,
  InternalServerError,
  JsonController,
  NotFoundError,
  Param,
  Post,
} from 'routing-controllers'
import { Repository } from 'typeorm'
import ChatPlugContext from '../../../ChatPlugContext'
import IFieldOptions, {
  fieldListMetadataKey,
  fieldOptionsMetadataKey,
  FieldType,
} from '../../../configWizard/IFieldOptions'
import Service from '../../../entity/Service'
import fs from 'fs-extra'

const CONFIG_FOLDER_PATH = path.join(__dirname, '../../../../config')
@JsonController('/services')
export default class ServicesController {
  servicesRepository: Repository<Service>
  context: ChatPlugContext
  constructor(context: ChatPlugContext) {
    this.context = context
    this.servicesRepository = context.connection.getRepository(Service)
  }

  @Get('/instances')
  async getServiceInstances() {
    const instances = await this.servicesRepository.find()
    const serviceModules = await this.context.serviceManager.getAvailableServices()
    return instances.map(ins => ({
      ...classToPlain(ins),
      serviceModule: serviceModules.find(
        sm => sm.moduleName === ins.moduleName,
      ),
    }))
  }

  @Post('/instances')
  async createNewInstance(
    @BodyParam('moduleName', { required: true }) serviceModuleName: string,
    @BodyParam('instanceName', { required: true }) serviceInstanceName: string,
    @BodyParam('config', { required: true, parse: true }) configuration: any,
  ) {
    const serviceModule = (await this.context.serviceManager.getAvailableServices()).find(
      el => el.moduleName === serviceModuleName,
    )
    if (!serviceModule) {
      throw new NotFoundError()
    }

    const schema = require(serviceModule.modulePath).Config
    const fieldList = Reflect.getMetadata(
      fieldListMetadataKey,
      new schema(),
    ) as string[]
    if (!fieldList.every(el => configuration[el] !== undefined)) {
      throw new BadRequestError('Config does not match schema')
    }

    if (!serviceModule) {
      throw new NotFoundError('Service with given name does not exist')
    }

    const instance = await this.servicesRepository.findOne({
      moduleName: serviceModuleName,
      instanceName: serviceInstanceName,
    })
    if (instance) {
      throw new InternalServerError('Instance with given name already exists')
    }

    fs.writeFileSync(
      path.join(
        CONFIG_FOLDER_PATH,
        serviceModule.moduleName + '.' + serviceInstanceName + '.toml',
      ),
      TOML.stringify(configuration),
    )

    const service = new Service()
    service.configured = true
    service.enabled = true
    service.instanceName = serviceInstanceName
    service.moduleName = serviceModule.moduleName

    await this.servicesRepository.save(service)
    return service
  }

  @Get('/')
  async getAvailableServices() {
    return await this.context.serviceManager.getAvailableServices()
  }

  @Get('/instances/:id/disable')
  async disableService() {}

  @Get('/:module/schema')
  async getConfigSchema(@Param('module') moduleName: string) {
    const serviceModule = (await this.context.serviceManager.getAvailableServices()).find(
      el => el.moduleName === moduleName,
    )
    if (!serviceModule) {
      throw new NotFoundError()
    }

    const schema = require(serviceModule.modulePath).Config
    const cfg = new schema()
    const fieldList = Reflect.getMetadata(fieldListMetadataKey, cfg) as string[]
    return fieldList.map(key => {
      const options = classToPlain(Reflect.getMetadata(
        fieldOptionsMetadataKey,
        cfg,
        key,
      ) as IFieldOptions)
      // @ts-ignore
      options.type = FieldType[options.type]
      if (options['required'] === undefined) {
        options['required'] = true
      }
      return options
    })
  }

  @Get('/instances/:id/enable')
  async enableService() {}
}
