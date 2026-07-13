import { LeafNotFoundError, createArweaveGetLeaf } from '@kargain/vincent/arweave';
import { verifyLeaf } from '@kargain/vincent/decoder';

export type GetLeafFn = ReturnType<typeof createArweaveGetLeaf>;

/** True when GraphQL finds the leaf and its Merkle proof matches merkleRoot. */
export async function isLeafAlreadyUploaded(
  getLeaf: GetLeafFn,
  leafKey: string,
  merkleRoot: string,
): Promise<boolean> {
  try {
    const fetched = await getLeaf(leafKey);
    return verifyLeaf(fetched.leaf, fetched.proof, merkleRoot).ok;
  } catch (error) {
    if (error instanceof LeafNotFoundError) {
      return false;
    }
    throw error;
  }
}
