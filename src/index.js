import * as StellarSdk from 'stellar-sdk';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import scrypt from 'scrypt-async';

const version = 'stellarport-1-20-2018';

const latestScryptOptions = {
    N: 16384,
    r: 8,
    p: 1,
    dkLen: nacl.secretbox.keyLength,
    encoding: 'binary'
};

export class StellarKeystore {
    /**
     * Retrieves a public key from a keystore file or json object.
     * @param keystore<Blob|Object>
     * @returns {Promise<StellarSdk.Keypair>}
     */
    publicKey(keystore) {
        return this._fileContents(keystore)
            .then(keystoreData => {
                return keystoreData.address;
            });
    }

    /**
     * Retrieves a stellar keypair from a keystore file or json object.
     * @param keystore<Blob|Object>
     * @param password<string>
     * @returns {Promise<StellarSdk.Keypair>}
     */
    keypair(keystore, password) {
        let keystoreData;
        return this._fileContents(keystore)
            .then(_keystoreData => {
                keystoreData = _keystoreData;
                return this._keyFromPassword(password, naclUtil.decodeBase64(keystoreData.crypto.salt), keystoreData.crypto.scryptOptions);
            })
            .then(key => {
                const secretKey = nacl.secretbox.open(naclUtil.decodeBase64(keystoreData.crypto.ciphertext), naclUtil.decodeBase64(keystoreData.crypto.nonce), key);

                if (!secretKey) {
                    throw new Error('Decryption failed. The file or password supplied is invalid.');
                }

                const keypair = StellarSdk.Keypair.fromSecret(naclUtil.encodeUTF8(secretKey));

                if (keypair.publicKey() !== keystoreData.address) {
                    throw new Error('The supplied keystore file inconsistent - public key does not match secret key.');
                }

                return keypair;
            })
    }

    /**
     * Creates a keystore file (using the provided keypair or a random keypair) and downloads it.
     * @deprecated
     * @param password
     * @param filename
     * @param [keypair]
     * @returns {Promise<StellarSdk.Keypair>}
     */
    createAndDownload(password, filename, keypair) {
        return this.create(password, keypair)
            .then(createdData => {
                this._download(filename, JSON.stringify(createdData.walletData));

                return createdData.keypair;
            });
    }

    /**
     * Creates a keystore file's contents using a provided password and the provided keypair or random keypair. Returns a json object representing the keypair file.
     * @param password
     * @param [keypair]
     * @returns {Promise<{keypair: StellarSdk.Keypair, fileData: {}}>}
     */
    create(password, keypair) {
        const newKeypair = keypair || StellarSdk.Keypair.random();
        const salt = nacl.randomBytes(32);
        return this._keyFromPassword(password, salt, latestScryptOptions)
            .then(key => {
                const nonce = this._randomNonce();
                const ciphertext = nacl.secretbox(naclUtil.decodeUTF8(newKeypair.secret()), nonce, key);
                return {
                    keypair: newKeypair,
                    walletData: {
                        version,
                        address: newKeypair.publicKey(),
                        crypto: {
                            ciphertext: naclUtil.encodeBase64(ciphertext),
                            nonce: naclUtil.encodeBase64(nonce),
                            salt: naclUtil.encodeBase64(salt),
                            scryptOptions: latestScryptOptions
                        }
                    }
                };
            });

    }

    _download(filename, text) {
        const element = document.createElement('a');
        element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
        element.setAttribute('download', filename + '.strz');

        element.style.display = 'none';
        document.body.appendChild(element);

        element.click();

        document.body.removeChild(element);
    }

    _fileContents(file) {
        // Check if this is a blob (for browser use).
        if (!(file.hasOwnProperty('size'))) {
            return Promise.resolve(file);
        }

        const fileReader = new FileReader();

        fileReader.readAsText(file);

        return new Promise((resolve, reject) => {
            fileReader.onload = function(event) {
                try {
                    resolve(JSON.parse(event.target.result));
                }
                catch (e) {
                    reject(new Error('Decryption failed. The file is not a valid keystore file.'));
                }
            };
        });
    }

    _keyFromPassword(password, salt, scryptOptions = latestScryptOptions) {
        return new Promise((resolve, reject) => {
            scrypt(
                password,
                salt,
                scryptOptions,
                resolve
            );
        });
    }

    _randomNonce() {
        return nacl.randomBytes(nacl.secretbox.nonceLength);
    }
}
