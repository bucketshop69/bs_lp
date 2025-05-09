import { CLMM_PROGRAM_ID, DEVNET_PROGRAM_ID, Raydium } from "@raydium-io/raydium-sdk-v2"
import { clusterApiUrl, Connection, Keypair } from "@solana/web3.js"

export const initSdk = async (params: { owner: Keypair, loadToken?: boolean, }) => {

    try {
        const connection = new Connection(process.env.SOLANA_RPC_ENDPOINT || 'https://api.devnet.solana.com')
        if (connection.rpcEndpoint === clusterApiUrl('mainnet-beta'))
            console.warn('using free rpc node might cause unexpected error, strongly suggest uses paid rpc node')
        return await Raydium.load({
            owner: params.owner,
            connection,
            cluster: "mainnet",
            disableFeatureCheck: true,
            disableLoadToken: !params?.loadToken,
            blockhashCommitment: 'finalized',
        })
    } catch (error) {
        console.error(error);
    }

}


const VALID_PROGRAM_ID = new Set([CLMM_PROGRAM_ID.toBase58(), DEVNET_PROGRAM_ID.CLMM.toBase58()])
export const isValidClmm = (id: string) => VALID_PROGRAM_ID.has(id)