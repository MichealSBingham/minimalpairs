"""Export a credential-free, identifiable English bank for application integration."""
import json
import studio as s

def main():
    db=s.connect();records=[]
    for row in db.execute("SELECT c.*,w.text,w.ipa,w.data AS word_data,w.flags FROM clips c JOIN words w ON w.id=c.word_id WHERE c.provider='chatterbox' AND w.bank='en-US-ga' AND c.status='complete' ORDER BY w.text,c.voice"):
        details=json.loads(row['details']);word=json.loads(row['word_data']);path=s.Path(row['path'])
        if s.sha(path.read_bytes())!=row['sha']:raise ValueError('Checksum mismatch: '+row['id'])
        records.append({'clipId':row['id'],'wordId':row['word_id'],'bankId':'en-US-ga','text':row['text'],'ipa':row['ipa'],'meanings':word['meanings'],'memberships':word['memberships'],'voiceId':row['voice'],'sha256':row['sha'],'relativeAudioPath':'clips/'+path.name,'reviewStatus':row['review'],'wordFlags':json.loads(row['flags']),'audioFlags':details['technicalAudit']['flags'],'generation':details})
    result={'schemaVersion':1,'collectionId':'chatterbox-us-four-voices-v1','status':'generated-unreviewed','clipCount':len(records),'wordCount':len({r['wordId'] for r in records}),'voices':sorted({r['voiceId'] for r in records}),'identityPolicy':'clipId is the stable word/voice slot; sha256 identifies the exact audio revision. Reviews must match sha256. Repairs retain original files and provenance.','clips':records}
    target=s.STATE/'english-integration-manifest.json';target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(f'Exported {len(records)} identified clips to {target}')
if __name__=='__main__':main()
