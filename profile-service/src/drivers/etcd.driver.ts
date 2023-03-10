import winston from 'winston';
import { inject, injectable } from 'inversify';
import { Etcd3, IKeyValue, IOptions as IETCDOptions, WatchBuilder, Watcher } from 'etcd3';

import { TYPES } from '../configs/di.types.config';
import { LoggerDriver } from './logger.driver';

import dotenv from 'dotenv';
dotenv.config();

/**
 * This module used for loading environment variables from ETCD server instead of `.env` or 
 * specificly mention in environment variables of the system.
 * 
 * This configuration can:
 * - Setting parameters by `.env` variables
 * - Getting paramaters threw ETCD
 * - Watch for changes on the paramaters loaded from ETCD
 * - Override `process.env` object
 * 
 * Parameters fallback is:
 * - Trying to load the wanted parameters directly from ETCD
 * - Loading additional variables from `.env` file (default configs `dotenv`)
 * - Loading the variables from the system (node)
 * 
 * All parameters get a copy inside envParams object
 */
@injectable()
export class EtcdDriver {
    // private Logger: winston.Logger;

    private client: Etcd3 = null;
    private proccesedConfigurations: IETCDConfigurations; // The configurations after merging with the user configs
    private _etcdWatcher: WatchBuilder = null;
    envParams: IEnvParams = null;

    private defaultConfigs: IETCDConfigurations = {
        envParams: {},
        driverConfigs: {
            dirname: process.env.ETCD_SERVICE_NAME
        }
    }

    // constructor(@inject(TYPES.LoggerConfig) LoggerConfig: LoggerConfig) {
    //     this.Logger = LoggerConfig.Logger;
    // }

    /**
     * @description This function creates a client to be to communicate with the etcd server
     * @param connectionOptions Connection options by the etcd3 library
     */
    public createClient(connectionOptions?: IETCDOptions): void {
        if (!this.client) {
            this.client = new Etcd3(connectionOptions);
            console.log('ETCD client has been created');
        }
    }

    // Override the default configurations with those passed from the user  
    private overrideDefaultConfigs(customConfigs: IETCDConfigurations): IETCDConfigurations {
        customConfigs.driverConfigs = { ...this.defaultConfigs.driverConfigs, ...customConfigs.driverConfigs };
        const overwrittenObject = { ...this.defaultConfigs, ...customConfigs };

        return overwrittenObject;
    }

    /**
     * @description Initialization of `process.env` variable with the data came from the ETCD
     * 
     * @param connectionOptions ETCD connection options
     * @param userDefinedConfigs Custom configurations object
     */
    async initialize(connectionOptions: IETCDOptions, userDefinedConfigs: IETCDConfigurations): Promise<void> {
        try {
            this.proccesedConfigurations = this.overrideDefaultConfigs(userDefinedConfigs);
            this.createClient(connectionOptions);
            this._etcdWatcher = this.client.watch();

            if (!this.proccesedConfigurations.driverConfigs?.dirname) 
                throw 'ETCD_SERVICE_NAME not found in environment variables';
            if (!this.proccesedConfigurations?.envParams || !Object.keys(this.proccesedConfigurations?.envParams).length)
                throw 'Configs arg does not contains any properties';

            await this.initializeProcess();
        } catch (ex) {
            console.error('initialize() ex:', ex);
        }
    }


    /**
     * @description Getting the setting of an property declared in @IETCDConfigurations if exists
     * @param propertyName Wanted property name
     * @returns The settings in case they exist
     */
    private getPropertySetting(propertyName: string): IETCDPropertyDefenition {
        if (typeof this.proccesedConfigurations.envParams[propertyName] !== "object")
            return undefined;

        return this.proccesedConfigurations.envParams[propertyName] as IETCDPropertyDefenition;
    }


    /**
     * @description Update the env variables (self-managed and process.env)
     * 
     * @param propertyName The propertyName to set in the variables
     * @param val The new value
     */
    private updateEnv(propertyName: string, val: any): void {
        if (this.proccesedConfigurations.driverConfigs.overrideSysObj) {
            console.log('Update new key in process.env');
            process.env[propertyName] = val;
        }

        // Saving a copy in self-managed object
        this.envParams[propertyName] = val;
    }

    /**
     * @description Watching for key changes in ETCD
     * 
     * @param key The key to watch
     * @param propertyName The propertyName to put in env (or `process.env`)
     */
    private async watchForChanges(key: string | Buffer, propertyName: string): Promise<void> {
        // TODO: Add support for callback per env key
        if (!this._etcdWatcher) throw 'There is no ETCD client, initialization is required';
        
        this._etcdWatcher.key(key).create().then((watcher: Watcher) => {
            watcher.on("put", (kv: IKeyValue, previous?: IKeyValue) => {
                console.log(`Updating the ${key} to:`, kv.value.toString());
                this.updateEnv(propertyName, kv.value.toString());
            });

            watcher.on("delete", async (kv: IKeyValue, previous?: IKeyValue) => {
                console.log(`Deleting param: ${propertyName} from envs`);
                if (this.envParams)
                    delete this.envParams[propertyName];
                
                if (this.proccesedConfigurations.driverConfigs?.overrideSysObj)
                    delete process.env[propertyName];

                // In case the key deleted,
                await watcher.cancel();
            });
        });
    }

    /**
     * @description Create environemnt specific "directories" in service's "directory" just in case specified
     */
    private getEnvironemntDir(): string {
        if (this.proccesedConfigurations?.driverConfigs?.genEnvDirectories && process.env.NODE_ENV)
            return `${process.env.NODE_ENV}/`;
        return '';
    }

    /**
     * @description Initializing `process.env` property keys, Checking for existence of the properties in the etcd.
     * In case the property exists, set it in the `process.env` object.
     */
     private async initializeProcess(): Promise<void> {
        for (const propertyName of Object.keys(this.proccesedConfigurations?.envParams)) {
            const propertySetting: IETCDPropertyDefenition = this.getPropertySetting(propertyName);
            const envDir: string = this.getEnvironemntDir();
            const generatedEtcdPath: string = `/${this.proccesedConfigurations.driverConfigs.dirname}/${envDir}${propertyName}`;
            const etcdEntryName: string = propertySetting?.etcdPath || generatedEtcdPath;
            
            // Checking the etcd entry exists. in case it does it will be set, else it will be the defaultValue
            const etcdVal = await this.client.get(etcdEntryName).string();
            const strDefaultVal: string | null | undefined = this.proccesedConfigurations.envParams[propertyName] !== '[object Object]' ?
                this.proccesedConfigurations.envParams[propertyName]?.toString() : undefined;
            
            if (this.proccesedConfigurations.driverConfigs?.overrideSysObj) {
                process.env[propertyName] = etcdVal || process.env[propertyName] || propertySetting?.defaultValue || strDefaultVal;
                console.log(`process.env[${propertyName}]:`, process.env[propertyName]);
            }

            if (!this.envParams) this.envParams = {};
            this.envParams[propertyName] = etcdVal || process.env[propertyName] || propertySetting?.defaultValue || strDefaultVal;

            if (this.proccesedConfigurations.driverConfigs?.watchKeys) {
                this.watchForChanges(etcdEntryName, propertyName);
            }

            if (!etcdVal && this.proccesedConfigurations.driverConfigs?.genKeys) {
                // Checking whether the client confirmed to change out of scope changes or the change is in the service scope
                if (this.proccesedConfigurations.driverConfigs?.overrideNotInScope || this.isInScope(etcdEntryName)) {
                    await this.client.put(etcdEntryName).value(process.env[propertyName]);
                } else {
                    console.log('Can not change/push out of scope variables, Property can be changed in driverConfigs');
                }
            }
        }
    }

    /**
     * @description Validate whether a key is in service's scope
     */
    private isInScope(keyName: string): boolean {
        /* 
            In case the key name includes minimum 2 `/`
            For example `/<service_name>/<some_key>`
        */
        const splittedKey: string[] = keyName.split('/');
        if (splittedKey.length >= 3) {
            if (splittedKey.length == 3 && splittedKey[splittedKey.length-1] !== '')
                return true;

            return splittedKey.length > 3;
        }

        return false;
    }
}

// Driver configurations
interface IETCDDriverConfigs {
    /**
     * @description The default "directory" (static-prefix) to search in keys, and save them
     */
    dirname?: string | Buffer;
    
    /**
     * @description Generating the keys if not exists in etcd by the given `defaultValue`. 
     * default value: false 
     */
    genKeys?: boolean;

    /**
     * @description Override the `process.env.${key}` with the data gathered from etcd. 
     * Otherwise, env will be accessed by `ETCDConfig.envParams` - default value: false
     */
    overrideSysObj?: boolean;
    
    /**
     * @description Watch the keys for change and update - default value: undefined
     */
    watchKeys?: boolean;

    /**
     * @description Allow to push/change variable outside service's scope - default value: false
     */
    overrideNotInScope?: boolean;

    /**
     * @description Save the environemnts specific variables in the service's etcd directory - default value: false
     */
    genEnvDirectories?: boolean;
}

interface IETCDPropertyDefenition {
    /**
     * @description Custom etcd path to retrive the value from
     */
    etcdPath: string;

    /**
     * @description Default value to put in case it not exists
     */
    defaultValue?: string;
}

export interface IETCDConfigurations {
    envParams: {
        // If the value is string, it's the defaultValue
        [propertyName: string]: IETCDPropertyDefenition | string;
    }

    /**
     * @description Specification of module configurations
     */
    driverConfigs?: IETCDDriverConfigs;
}

export interface IEnvParams {
    [keyName: string]: any;
}
